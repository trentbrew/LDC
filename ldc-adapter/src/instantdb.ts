/**
 * InstantDB LD-C Adapter
 * Reuses @ldc/datatable-core for zero-drift computation
 */

import type {
  LdcAdapter,
  QuerySpec,
  LdcResult,
  LdcDocument,
  ColumnDef,
  QueryOptions,
  ProvenanceOp,
} from './types';
import { createDiagnostic } from './types';
import { filterData, sortData, paginateData } from '@ldc/datatable-core';

/**
 * InstantDB connection interface (minimal)
 */
export interface InstantDBConnection {
  db: {
    query: (collection: string) => {
      get: () => Promise<any[]>;
    };
  };
}

/**
 * Infer column definitions from data rows
 */
function inferColumns<T>(rows: T[]): ColumnDef<T>[] {
  if (rows.length === 0) return [];
  
  const first = rows[0] ?? {};
  return Object.keys(first as Record<string, unknown>).map((k) => ({
    id: k,
    path: k,
    type: inferType((first as any)[k]),
  }));
}

/**
 * Infer type from value
 */
function inferType(v: unknown): ColumnDef["type"] {
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (v instanceof Date) return "date";
  if (Array.isArray(v)) return "array";
  if (v && typeof v === "object") return "object";
  return "string";
}

/**
 * Validate column exists in data
 */
function validateColumn(columnId: string, columns: ColumnDef[]): boolean {
  return columns.some(col => col.id === columnId);
}

/**
 * InstantDB adapter implementing LdcAdapter
 */
export class InstantDBLdcAdapter implements LdcAdapter {
  constructor(
    private instant: InstantDBConnection,
    private context: Record<string, string> = {}
  ) {}

  async toLdcDocument(collection: string): Promise<LdcDocument> {
    const items = await this.instant.db.query(collection).get();
    
    return {
      "@context": this.context,
      "@id": `instant:${collection}`,
      "@type": "Collection",
      items,
      // Callers can add compute later or call executeQuery with compute
    };
  }

  async executeQuery<T = unknown>(
    spec: QuerySpec,
    opts?: QueryOptions
  ): Promise<LdcResult<T>> {
    const t0 = performance.now?.() ?? Date.now();
    const ops: ProvenanceOp[] = [];
    const diagnostics: LdcResult["diagnostics"] = [];

    // 1) Fetch from InstantDB
    const source = `instant:${spec.collection}`;
    let rows: any[];
    
    try {
      rows = await this.instant.db.query(spec.collection).get();
      ops.push({
        kind: "fetch",
        at: new Date().toISOString(),
        detail: { count: rows.length, source },
      });
    } catch (error) {
      return {
        value: [] as any,
        diagnostics: [
          createDiagnostic("eval_error", `Failed to fetch collection: ${error}`, {
            severity: "error",
          }),
        ],
        prov: { ops, source },
        perf: { durationMs: (performance.now?.() ?? Date.now()) - t0 },
      };
    }

    // 2) Infer or use provided columns
    const columns = spec.columns?.length ? spec.columns : inferColumns(rows);

    // 3) Filter
    if (spec.filter?.length) {
      // Validate columns
      for (const f of spec.filter) {
        if (!validateColumn(f.columnId, columns)) {
          diagnostics.push(
            createDiagnostic("bad_column", `Unknown column: ${f.columnId}`, {
              path: `filter.${f.columnId}`,
              severity: "warning",
            })
          );
          continue;
        }
      }
      
      // Only apply valid filters
      const validFilters = spec.filter.filter(f => 
        validateColumn(f.columnId, columns)
      );
      
      if (validFilters.length) {
        try {
          rows = filterData(rows, validFilters, columns);
          ops.push({
            kind: "filter",
            at: new Date().toISOString(),
            detail: validFilters,
          });
        } catch (error) {
          diagnostics.push(
            createDiagnostic("bad_filter", `Filter failed: ${error}`, {
              severity: "error",
            })
          );
        }
      }
    }

    // 4) Sort
    if (spec.sort?.length) {
      // Validate columns
      for (const s of spec.sort) {
        if (!validateColumn(s.columnId, columns)) {
          diagnostics.push(
            createDiagnostic("bad_column", `Unknown column: ${s.columnId}`, {
              path: `sort.${s.columnId}`,
              severity: "warning",
            })
          );
          continue;
        }
      }
      
      // Only apply valid sorts
      const validSorts = spec.sort.filter(s =>
        validateColumn(s.columnId, columns)
      );
      
      if (validSorts.length) {
        try {
          rows = sortData(rows, validSorts, columns);
          ops.push({
            kind: "sort",
            at: new Date().toISOString(),
            detail: validSorts,
          });
        } catch (error) {
          diagnostics.push(
            createDiagnostic("eval_error", `Sort failed: ${error}`, {
              severity: "error",
            })
          );
        }
      }
    }

    // 5) Paginate
    if (spec.paginate) {
      try {
        rows = paginateData(rows, spec.paginate);
        ops.push({
          kind: "paginate",
          at: new Date().toISOString(),
          detail: spec.paginate,
        });
      } catch (error) {
        diagnostics.push(
          createDiagnostic("eval_error", `Pagination failed: ${error}`, {
            severity: "error",
          })
        );
      }
    }

    // 6) Compute (optional): run LD-C safely/deterministically
    let value: any = rows;
    
    if (spec.compute && Object.keys(spec.compute).length) {
      // TODO: Integrate with @ldc/runtime when available
      // For now, return items + placeholder for computed values
      const computed: Record<string, any> = {};
      
      for (const [key, expr] of Object.entries(spec.compute)) {
        // Simple eval for common patterns (production should use @ldc/runtime)
        try {
          const exprStr = expr["@expr"];
          
          // Handle common aggregations safely
          if (exprStr.includes("items.filter") && exprStr.includes(".length")) {
            // Example: "items.filter(i => !i.done).length"
            const filterMatch = exprStr.match(/items\.filter\(i => ([^)]+)\)\.length/);
            if (filterMatch) {
              const condition = filterMatch[1];
              // Very basic eval (production needs safe sandbox)
              const filtered = rows.filter((i: any) => {
                try {
                  return Function('i', `return ${condition}`)(i);
                } catch {
                  return false;
                }
              });
              computed[key] = filtered.length;
            }
          } else if (exprStr === "items.length") {
            computed[key] = rows.length;
          } else {
            diagnostics.push(
              createDiagnostic("eval_error", `Unsupported expression: ${exprStr}`, {
                path: `compute.${key}`,
                severity: "warning",
              })
            );
            computed[key] = null;
          }
        } catch (error) {
          diagnostics.push(
            createDiagnostic("eval_error", `Compute failed for ${key}: ${error}`, {
              path: `compute.${key}`,
              severity: "error",
            })
          );
          computed[key] = null;
        }
      }
      
      value = { items: rows, ...computed };
      ops.push({
        kind: "compute",
        at: new Date().toISOString(),
        detail: { keys: Object.keys(spec.compute) },
      });
    }

    const t1 = performance.now?.() ?? Date.now();
    
    return {
      value: value as T,
      diagnostics,
      prov: {
        ops,
        source,
        asOf: opts?.asOf,
      },
      perf: {
        durationMs: t1 - t0,
      },
    };
  }
}
