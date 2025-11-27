# @ldc/adapter

Thin adapter layer for LD-C computation over various backends.

## Overview

`@ldc/adapter` provides a runtime-agnostic contract for executing LD-C queries with full provenance tracking. It reuses `@ldc/datatable-core` for **zero-drift computation** between UI and agent queries.

## Features

- ✅ **Zero Drift** - UI and agent queries use identical sort/filter/paginate logic
- ✅ **Provenance** - Full operation history with timestamps and details
- ✅ **Type Safe** - Comprehensive TypeScript types with strict checking
- ✅ **Error Recovery** - Typed diagnostics for agent repair
- ✅ **Performance** - Tracks execution time for optimization
- ✅ **Extensible** - Easy to add adapters for new backends

## Installation

```bash
pnpm add @ldc/adapter
```

## Quick Start

### Basic Usage

```typescript
import { InstantDBLdcAdapter } from '@ldc/adapter';

// Create adapter
const adapter = new InstantDBLdcAdapter(instant, {
  ex: 'https://example.com/'
});

// Execute query with provenance
const result = await adapter.executeQuery({
  collection: 'todos',
  filter: [{ columnId: 'done', op: 'eq', value: false }],
  sort: [{ columnId: 'priority', dir: 'desc' }],
  paginate: { pageIndex: 0, pageSize: 10 },
  compute: {
    openCount: { '@expr': 'items.filter(i => !i.done).length' }
  }
});

console.log(result.value);      // Filtered, sorted, paginated data
console.log(result.prov);       // Full provenance trail
console.log(result.diagnostics); // Any warnings/errors
console.log(result.perf);       // Performance metrics
```

### Agent Tool Integration

```typescript
// packages/agent-core/src/tools/tasks.ts
import { InstantDBLdcAdapter } from '@ldc/adapter';

export const searchTasks = {
  name: 'search_tasks',
  description: 'Search tasks with LD-C verification',
  
  async execute({ filters, sort, pageIndex = 0, pageSize = 20 }) {
    const adapter = new InstantDBLdcAdapter(instant, {
      ex: 'https://example.com/'
    });
    
    const result = await adapter.executeQuery({
      collection: 'todos',
      filter: filters,
      sort,
      paginate: { pageIndex, pageSize },
      compute: {
        openCount: { '@expr': 'items.filter(i => !i.done).length' },
        highPriorityPerWeek: { '@expr': 'items.filter(i => i.priority==="high").length / 7' }
      }
    });
    
    return {
      tasks: result.value.items ?? result.value,
      metrics: {
        openCount: result.value.openCount,
        highPriorityPerWeek: result.value.highPriorityPerWeek
      },
      provenance: result.prov,
      diagnostics: result.diagnostics
    };
  }
};
```

### UI Integration

```typescript
// apps/web/components/TasksView.tsx
import { DataTable } from '@ldc/datatable-react';
import { InstantDBLdcAdapter } from '@ldc/adapter';

export function TasksView() {
  const [rows, setRows] = useState([]);
  const adapterRef = useRef<InstantDBLdcAdapter>();
  
  useEffect(() => {
    adapterRef.current = new InstantDBLdcAdapter(instant, {
      ex: 'https://example.com/'
    });
    
    adapterRef.current
      .toLdcDocument('todos')
      .then(doc => setRows(doc.items ?? []));
  }, []);
  
  return (
    <DataTable
      data={rows}
      columns={columns}
      // Agent queries use same adapter - zero drift!
      onAgentQuery={(q) => adapterRef.current!.executeQuery(q)}
    />
  );
}
```

## API Reference

### Types

#### `QuerySpec`

```typescript
interface QuerySpec {
  collection: string;
  columns?: ColumnDef[];
  filter?: Array<{ columnId: string; op: FilterOp; value?: unknown }>;
  sort?: Array<{ columnId: string; dir: SortDir }>;
  paginate?: { pageIndex: number; pageSize: number };
  compute?: Record<string, { '@expr': string }>;
}
```

#### `LdcResult`

```typescript
interface LdcResult<T = unknown> {
  value: T;
  diagnostics: Array<{
    code: DiagnosticCode;
    message: string;
    path?: string;
    severity?: 'error' | 'warning' | 'info';
  }>;
  prov: {
    ops: ProvenanceOp[];
    source: string;
    asOf?: string;
  };
  perf?: {
    durationMs: number;
  };
}
```

### Filter Operations

| Operation | Description | Example |
|-----------|-------------|---------|
| `eq` | Equals | `{ op: 'eq', value: 'done' }` |
| `neq` | Not equals | `{ op: 'neq', value: null }` |
| `gt` | Greater than | `{ op: 'gt', value: 10 }` |
| `gte` | Greater than or equal | `{ op: 'gte', value: 0 }` |
| `lt` | Less than | `{ op: 'lt', value: 100 }` |
| `lte` | Less than or equal | `{ op: 'lte', value: 50 }` |
| `in` | In array | `{ op: 'in', value: ['a', 'b'] }` |
| `nin` | Not in array | `{ op: 'nin', value: ['x'] }` |
| `contains` | String contains | `{ op: 'contains', value: 'test' }` |
| `icontains` | Case-insensitive contains | `{ op: 'icontains', value: 'Test' }` |
| `exists` | Field exists | `{ op: 'exists' }` |
| `missing` | Field missing | `{ op: 'missing' }` |

### Diagnostic Codes

| Code | Description | Agent Action |
|------|-------------|--------------|
| `cap_denied` | Capability not allowed | Request permission |
| `timeout` | Compute exceeded budget | Simplify query |
| `shape_violation` | Output shape mismatch | Fix schema |
| `unit_mismatch` | Dimensional analysis failed | Check units |
| `bad_filter` | Invalid filter | Fix filter spec |
| `bad_column` | Unknown column | Use valid column |
| `bad_op` | Unsupported operation | Use supported op |
| `missing_context` | Missing @context | Add context |
| `eval_error` | Computation failed | Check expression |

## Provenance

Every query returns a complete provenance trail:

```typescript
const result = await adapter.executeQuery({
  collection: 'todos',
  filter: [{ columnId: 'done', op: 'eq', value: false }],
  sort: [{ columnId: 'priority', dir: 'desc' }],
  paginate: { pageIndex: 0, pageSize: 10 }
});

// Provenance includes all operations in order
result.prov.ops.forEach(op => {
  console.log(`${op.kind} at ${op.at}`);
  console.log(op.detail);
});

// Output:
// fetch at 2025-01-15T10:00:00Z
// { count: 100, source: 'instant:todos' }
// filter at 2025-01-15T10:00:01Z
// [{ columnId: 'done', op: 'eq', value: false }]
// sort at 2025-01-15T10:00:02Z
// [{ columnId: 'priority', dir: 'desc' }]
// paginate at 2025-01-15T10:00:03Z
// { pageIndex: 0, pageSize: 10 }
```

## Zero Drift Guarantee

The adapter uses `@ldc/datatable-core` for all data operations, ensuring **identical results** between UI and agent queries:

```typescript
// UI uses datatable-react (which uses datatable-core internally)
<DataTable data={data} columns={columns} />

// Agent uses adapter (which uses datatable-core directly)
const result = await adapter.executeQuery(spec);

// ✅ Both see the same filtered, sorted, paginated data
```

## Error Handling

Errors are returned as diagnostics, not thrown:

```typescript
const result = await adapter.executeQuery({
  collection: 'todos',
  filter: [{ columnId: 'invalid_column', op: 'eq', value: 'foo' }]
});

if (result.diagnostics.length > 0) {
  result.diagnostics.forEach(diag => {
    console.log(`[${diag.severity}] ${diag.code}: ${diag.message}`);
    // Output: [warning] bad_column: Unknown column: invalid_column
  });
}

// Query still executes with valid operations
console.log(result.value); // All data (invalid filter ignored)
```

## Testing

Run tests:

```bash
pnpm test
```

Run with coverage:

```bash
pnpm test:coverage
```

## Examples

See `tests/instantdb.test.ts` for comprehensive examples including:

- Zero-drift parity tests
- Provenance tracking
- Error handling
- Compute operations
- Edge cases

## Architecture

```
┌─────────────────────────────────────────┐
│   Agent Tools / UI Components           │
│   (Query for data)                      │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│   @ldc/adapter                          │
│   (QuerySpec → LdcResult)               │
│   • Provenance tracking                 │
│   • Error diagnostics                   │
│   • Performance metrics                 │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│   @ldc/datatable-core                   │
│   (Pure functions)                      │
│   • filterData()                        │
│   • sortData()                          │
│   • paginateData()                      │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│   Backend (InstantDB, etc)              │
│   (Storage)                             │
└─────────────────────────────────────────┘
```

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

MIT
