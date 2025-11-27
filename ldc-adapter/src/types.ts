/**
 * LD-C Adapter Types
 * Thin, typed contract for LD-C computation over various backends
 */

export type IRI = string;

export type LdcContext = Record<string, IRI>;

export interface LdcDocument {
  "@context": LdcContext;
  "@id"?: IRI;
  "@type"?: string | string[];
  // Arbitrary fields + computed bits (@expr, @view, @query) allowed
  [k: string]: unknown;
}

export type SortDir = "asc" | "desc";

export type FilterOp =
  | "eq" | "neq"
  | "gt" | "gte" | "lt" | "lte"
  | "in" | "nin"
  | "contains" | "icontains"
  | "exists" | "missing";

export interface ColumnDef<T = any> {
  id: string;
  path?: string;        // JSONPath-like accessor for nested data
  type?: "string" | "number" | "boolean" | "date" | "iri" | "array" | "object";
  unit?: string;        // optional unit hint for LD-C runtime
  label?: string;
  compute?: { "@expr": string }; // optional per-column computation
}

export interface QuerySpec {
  collection: string;            // e.g. "todos"
  columns?: ColumnDef[];
  filter?: Array<{ columnId: string; op: FilterOp; value?: unknown }>;
  sort?: Array<{ columnId: string; dir: SortDir }>;
  paginate?: { pageIndex: number; pageSize: number };
  // Optional LD-C compute on the result set (e.g. totals, metrics, reshaping)
  compute?: Record<string, { "@expr": string }>;
  // Future: graphy queries
  match?: string;                // SPARQL-ish pattern, optional
  select?: unknown;              // projection, optional
}

export interface ProvenanceOp {
  kind: "fetch" | "filter" | "sort" | "paginate" | "compute";
  at: string;                    // ISO timestamp
  detail?: unknown;
}

export interface LdcResult<T = unknown> {
  value: T;
  diagnostics: Array<{
    code: DiagnosticCode;
    message: string;
    path?: string;
    severity?: "error" | "warning" | "info";
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

/**
 * Diagnostic codes for error handling and agent repair
 */
export type DiagnosticCode =
  | "cap_denied"         // attempted capability not in allowlist
  | "timeout"            // compute step exceeded budget
  | "shape_violation"    // output doesn't match expected shape
  | "unit_mismatch"      // dimensional analysis failed
  | "bad_filter"         // invalid filter specification
  | "bad_column"         // user asked for unknown column
  | "bad_op"             // unsupported filter operation
  | "missing_context"    // @context required but missing
  | "eval_error";        // computation failed

export interface QueryOptions {
  now?: Date;
  asOf?: string;
  timeoutMs?: number;
  caps?: Record<string, boolean>;
  orgId?: string;        // multi-tenant isolation
}

/**
 * Core adapter interface
 */
export interface LdcAdapter {
  /**
   * Convert a collection to an LD-C document
   */
  toLdcDocument(collection: string): Promise<LdcDocument>;
  
  /**
   * Execute a query specification with provenance tracking
   */
  executeQuery<T = unknown>(
    spec: QuerySpec,
    opts?: QueryOptions
  ): Promise<LdcResult<T>>;
}

/**
 * Type guard for checking if a value is an LdcDocument
 */
export function isLdcDocument(value: unknown): value is LdcDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    '@context' in value &&
    typeof (value as any)['@context'] === 'object'
  );
}

/**
 * Helper to create a diagnostic
 */
export function createDiagnostic(
  code: DiagnosticCode,
  message: string,
  opts?: {
    path?: string;
    severity?: "error" | "warning" | "info";
  }
): LdcResult["diagnostics"][0] {
  return {
    code,
    message,
    path: opts?.path,
    severity: opts?.severity ?? "error",
  };
}
