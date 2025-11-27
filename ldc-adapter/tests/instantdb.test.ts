/**
 * InstantDB Adapter Tests
 * Comprehensive tests for zero-drift, provenance, and error handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InstantDBLdcAdapter } from '../src/instantdb';
import type { InstantDBConnection, QuerySpec } from '../src/types';
import { filterData, sortData, paginateData } from '@ldc/datatable-core';

// Test data
const seedTodos = [
  { id: 1, text: 'Buy milk', done: false, priority: 'high', createdAt: '2025-01-01' },
  { id: 2, text: 'Write docs', done: true, priority: 'medium', createdAt: '2025-01-02' },
  { id: 3, text: 'Fix bug', done: false, priority: 'high', createdAt: '2025-01-03' },
  { id: 4, text: 'Review PR', done: false, priority: 'low', createdAt: '2025-01-04' },
  { id: 5, text: 'Deploy', done: true, priority: 'high', createdAt: '2025-01-05' },
];

// Mock InstantDB
function createMockInstantDB(data: Record<string, any[]>): InstantDBConnection {
  return {
    db: {
      query: (collection: string) => ({
        get: async () => data[collection] || [],
      }),
    },
  };
}

describe('InstantDB LD-C Adapter', () => {
  let adapter: InstantDBLdcAdapter;
  let mockInstant: InstantDBConnection;

  beforeEach(() => {
    mockInstant = createMockInstantDB({ todos: [...seedTodos] });
    adapter = new InstantDBLdcAdapter(mockInstant, {
      ex: 'https://example.com/',
    });
  });

  describe('toLdcDocument', () => {
    it('converts collection to LD-C document', async () => {
      const doc = await adapter.toLdcDocument('todos');

      expect(doc).toMatchObject({
        '@context': { ex: 'https://example.com/' },
        '@id': 'instant:todos',
        '@type': 'Collection',
      });
      expect(doc.items).toHaveLength(5);
    });

    it('returns empty items for non-existent collection', async () => {
      const doc = await adapter.toLdcDocument('nonexistent');
      
      expect(doc.items).toEqual([]);
    });
  });

  describe('Parity Tests: Zero Drift with Core', () => {
    it('applies filter with parity to core', async () => {
      const filter = [{ columnId: 'done', op: 'eq' as const, value: false }];
      const columns = [
        { id: 'id', type: 'number' as const },
        { id: 'text', type: 'string' as const },
        { id: 'done', type: 'boolean' as const },
        { id: 'priority', type: 'string' as const },
      ];

      const spec: QuerySpec = {
        collection: 'todos',
        columns,
        filter,
      };

      const result = await adapter.executeQuery(spec);
      const coreDirect = filterData(seedTodos, filter, columns);

      expect((result.value as any[]).map(x => x.id)).toEqual(
        coreDirect.map(x => x.id)
      );
    });

    it('applies sort with parity to core', async () => {
      const sort = [{ columnId: 'priority', dir: 'desc' as const }];
      const columns = [
        { id: 'id', type: 'number' as const },
        { id: 'priority', type: 'string' as const },
      ];

      const spec: QuerySpec = {
        collection: 'todos',
        columns,
        sort,
      };

      const result = await adapter.executeQuery(spec);
      const coreDirect = sortData(seedTodos, sort, columns);

      expect((result.value as any[]).map(x => x.id)).toEqual(
        coreDirect.map(x => x.id)
      );
    });

    it('applies filter+sort+paginate in order with parity to core', async () => {
      const filter = [{ columnId: 'done', op: 'eq' as const, value: false }];
      const sort = [{ columnId: 'priority', dir: 'desc' as const }];
      const paginate = { pageIndex: 0, pageSize: 2 };
      const columns = [
        { id: 'id', type: 'number' as const },
        { id: 'done', type: 'boolean' as const },
        { id: 'priority', type: 'string' as const },
      ];

      const spec: QuerySpec = {
        collection: 'todos',
        columns,
        filter,
        sort,
        paginate,
      };

      const result = await adapter.executeQuery(spec);
      
      // Apply same operations using core directly
      const filtered = filterData(seedTodos, filter, columns);
      const sorted = sortData(filtered, sort, columns);
      const paginated = paginateData(sorted, paginate);

      expect((result.value as any[]).map(x => x.id)).toEqual(
        paginated.map(x => x.id)
      );
    });
  });

  describe('Compute Operations', () => {
    it('computes simple aggregations', async () => {
      const spec: QuerySpec = {
        collection: 'todos',
        compute: {
          openCount: { '@expr': 'items.filter(i => !i.done).length' },
          total: { '@expr': 'items.length' },
        },
      };

      const result = await adapter.executeQuery(spec);
      
      expect((result.value as any).openCount).toBe(3); // 3 not done
      expect((result.value as any).total).toBe(5);
      expect((result.value as any).items).toHaveLength(5);
    });

    it('handles invalid expressions gracefully', async () => {
      const spec: QuerySpec = {
        collection: 'todos',
        compute: {
          invalid: { '@expr': 'this.is.not.valid' },
        },
      };

      const result = await adapter.executeQuery(spec);
      
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('eval_error');
      expect(result.diagnostics[0].severity).toBe('warning');
    });
  });

  describe('Error Handling & Diagnostics', () => {
    it('returns bad_column diagnostic for unknown column in filter', async () => {
      const spec: QuerySpec = {
        collection: 'todos',
        filter: [{ columnId: 'nonexistent', op: 'eq', value: 'foo' }],
      };

      const result = await adapter.executeQuery(spec);
      
      const badColDiag = result.diagnostics.find(d => d.code === 'bad_column');
      expect(badColDiag).toBeDefined();
      expect(badColDiag?.message).toContain('nonexistent');
      expect(badColDiag?.severity).toBe('warning');
    });

    it('returns bad_column diagnostic for unknown column in sort', async () => {
      const spec: QuerySpec = {
        collection: 'todos',
        sort: [{ columnId: 'invalid', dir: 'asc' }],
      };

      const result = await adapter.executeQuery(spec);
      
      const badColDiag = result.diagnostics.find(d => d.code === 'bad_column');
      expect(badColDiag).toBeDefined();
      expect(badColDiag?.path).toContain('sort.invalid');
    });

    it('continues with valid operations when some are invalid', async () => {
      const spec: QuerySpec = {
        collection: 'todos',
        filter: [
          { columnId: 'done', op: 'eq', value: false }, // valid
          { columnId: 'invalid', op: 'eq', value: 'foo' }, // invalid
        ],
      };

      const result = await adapter.executeQuery(spec);
      
      // Should still filter by 'done'
      expect((result.value as any[]).every((t: any) => !t.done)).toBe(true);
      
      // Should have diagnostic about invalid column
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('bad_column');
    });
  });

  describe('Provenance Tracking', () => {
    it('records operations in correct order: fetch → filter → sort → paginate → compute', async () => {
      const spec: QuerySpec = {
        collection: 'todos',
        filter: [{ columnId: 'done', op: 'eq', value: false }],
        sort: [{ columnId: 'priority', dir: 'desc' }],
        paginate: { pageIndex: 0, pageSize: 2 },
        compute: {
          count: { '@expr': 'items.length' },
        },
      };

      const result = await adapter.executeQuery(spec);
      
      const opKinds = result.prov.ops.map(op => op.kind);
      expect(opKinds).toEqual(['fetch', 'filter', 'sort', 'paginate', 'compute']);
    });

    it('includes timestamps and details in provenance', async () => {
      const spec: QuerySpec = {
        collection: 'todos',
        filter: [{ columnId: 'done', op: 'eq', value: false }],
      };

      const result = await adapter.executeQuery(spec);
      
      expect(result.prov.source).toBe('instant:todos');
      expect(result.prov.ops).toHaveLength(2); // fetch + filter
      
      const fetchOp = result.prov.ops[0];
      expect(fetchOp.kind).toBe('fetch');
      expect(fetchOp.at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
      expect(fetchOp.detail).toMatchObject({ count: 5, source: 'instant:todos' });
      
      const filterOp = result.prov.ops[1];
      expect(filterOp.kind).toBe('filter');
      expect(filterOp.detail).toEqual(spec.filter);
    });

    it('includes asOf when provided', async () => {
      const asOf = '2025-01-01T00:00:00Z';
      const spec: QuerySpec = {
        collection: 'todos',
      };

      const result = await adapter.executeQuery(spec, { asOf });
      
      expect(result.prov.asOf).toBe(asOf);
    });
  });

  describe('Performance Tracking', () => {
    it('includes execution duration', async () => {
      const spec: QuerySpec = {
        collection: 'todos',
      };

      const result = await adapter.executeQuery(spec);
      
      expect(result.perf).toBeDefined();
      expect(result.perf?.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.perf?.durationMs).toBeLessThan(1000); // Should be fast
    });
  });

  describe('Column Inference', () => {
    it('infers columns from data when not provided', async () => {
      const spec: QuerySpec = {
        collection: 'todos',
        sort: [{ columnId: 'id', dir: 'asc' }],
      };

      const result = await adapter.executeQuery(spec);
      
      // Should work without explicit column definitions
      expect((result.value as any[])).toHaveLength(5);
      expect((result.value as any[])[0].id).toBe(1);
    });
  });

  describe('Empty and Edge Cases', () => {
    it('handles empty collection', async () => {
      const emptyMock = createMockInstantDB({ empty: [] });
      const emptyAdapter = new InstantDBLdcAdapter(emptyMock);
      
      const spec: QuerySpec = {
        collection: 'empty',
        compute: {
          count: { '@expr': 'items.length' },
        },
      };

      const result = await emptyAdapter.executeQuery(spec);
      
      expect((result.value as any).items).toEqual([]);
      expect((result.value as any).count).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('handles pagination beyond available data', async () => {
      const spec: QuerySpec = {
        collection: 'todos',
        paginate: { pageIndex: 10, pageSize: 10 },
      };

      const result = await adapter.executeQuery(spec);
      
      expect((result.value as any[])).toEqual([]);
    });
  });
});
