// Minimal SPARQL-lite query engine for LD-C
import type { QuadStore } from "../types";

export type Iri = string;

export type Term =
  | { var: string }
  | { iri: Iri }
  | { lit: unknown };

export interface TriplePattern {
  s: Term;
  p: Term | { a: true };
  o: Term;
}

export interface OptionalGroup {
  optional: TriplePattern[];
  filters?: unknown[];
}

export interface LdcQuery {
  patterns: (TriplePattern | OptionalGroup)[];
  filters?: unknown[];
  select: Array<string | { [alias: string]: string | unknown | { agg: "sum"|"count"|"min"|"max"|"avg"; expr?: unknown } }>;
  groupBy?: string[];
  having?: unknown[];
  orderBy?: Array<string>;
  limit?: number;
}

export type Binding = Record<string, unknown>;
export type Rows = Binding[];

const isVar = (t: Term): t is { var: string } => (t as any).var !== undefined;
const isIri = (t: Term): t is { iri: Iri } => (t as any).iri !== undefined;
const isLit = (t: Term): t is { lit: unknown } => (t as any).lit !== undefined;
const isA = (p: any): p is { a: true } => p && (p as any).a === true;

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export interface RunQueryOpts {
  evalExpr: (expr: unknown, scope: Binding) => unknown;
}

export function runQuery(store: QuadStore, q: LdcQuery, opts: RunQueryOpts): Rows {
  let rows: Rows = [{}];

  const applyTriple = (rowsIn: Rows, tp: TriplePattern): Rows => {
    const P = isA(tp.p) ? RDF_TYPE : (isIri(tp.p) ? tp.p.iri : null);
    const out: Rows = [];
    for (const row of rowsIn) {
      const sB = bindOf(tp.s, row);
      const oB = bindOf(tp.o, row);
      const candidates = match(store, isIri(tp.s) ? tp.s.iri : (typeof sB === "string" ? (sB as string) : undefined), P ?? undefined, isIri(tp.o) ? tp.o.iri : (oB ?? undefined));
      for (const qd of candidates) {
        const next = { ...row };
        let ok = true;
        if (isVar(tp.s)) {
          const prev = next[tp.s.var];
          if (prev !== undefined && prev !== qd.s) ok = false; else next[tp.s.var] = qd.s;
        } else if (isLit(tp.s)) ok = false;
        if (!ok) continue;

        if (isVar(tp.o)) {
          const prev = next[tp.o.var];
          if (prev !== undefined && !eq(prev, qd.o)) ok = false; else next[tp.o.var] = qd.o;
        } else if (isLit(tp.o) && !eq(tp.o.lit, qd.o)) ok = false;
        else if (isIri(tp.o) && tp.o.iri !== qd.o) ok = false;

        if (ok) out.push(next);
      }
    }
    return out;
  };

  for (const pat of q.patterns) {
    if ((pat as any).optional) {
      const group = pat as OptionalGroup;
      const optVars = varsIn(group.optional);
      const after = group.optional.reduce(applyTriple, rows);
      const filtered = group.filters && group.filters.length ? after.filter(r => group.filters!.every(f => truthy(opts.evalExpr(f, r)))) : after;
      const merged: Rows = [];
      for (const r of filtered) merged.push(r);
      for (const base of rows) {
        if (!filtered.some(r => includesAll(r, base))) {
          const withNulls = { ...base };
          for (const v of optVars) if (!(v in withNulls)) withNulls[v] = null;
          merged.push(withNulls);
        }
      }
      rows = merged;
    } else {
      rows = applyTriple(rows, pat as TriplePattern);
    }
  }

  if (q.filters && q.filters.length) rows = rows.filter(r => q.filters!.every(f => truthy(opts.evalExpr(f, r))));

  const sel = q.select;
  const groupVars = q.groupBy ?? [];
  if (groupVars.length) {
    const keyFn = (r: Binding) => JSON.stringify(groupVars.map(v => r[v.replace(/^\?/, "")] ?? null));
    const groups = groupBy(rows, keyFn);
    const outRows: Rows = [];
    for (const [, bucket] of groups) {
      const anyRow = bucket[0] ?? {};
      const scopeBase: Binding = { ...anyRow };
      const out: Binding = {};
      for (const item of sel) {
        if (typeof item === "string") { out[item.slice(1)] = scopeBase[item.slice(1)]; continue; }
        const [alias, spec] = Object.entries(item)[0]!;
        if (typeof spec === "string" && spec.startsWith("?")) out[alias] = scopeBase[spec.slice(1)];
        else if (isAggSpec(spec)) {
          const values = bucket.map(r => opts.evalExpr(spec.expr ?? { "@var": "_row" }, r));
          out[alias] = runAgg(spec.agg, values);
        } else out[alias] = opts.evalExpr(spec, scopeBase);
      }
      if (!q.having || q.having.every(h => truthy(opts.evalExpr(h, out)))) outRows.push(out);
    }
    rows = outRows;
  } else {
    // No GROUP BY: if any aggregates are present, compute a single aggregated row
    const hasAgg = sel.some((it) => typeof it !== "string" && isAggSpec(Object.values(it)[0] as any));
    if (hasAgg) {
      const obj: Binding = {};
      for (const item of sel) {
        if (typeof item === "string") { obj[item.slice(1)] = rows[0]?.[item.slice(1)]; continue; }
        const [alias, spec] = Object.entries(item)[0]!;
        if (typeof spec === "string" && spec.startsWith("?")) obj[alias] = rows[0]?.[spec.slice(1)];
        else if (isAggSpec(spec)) {
          const values = rows.map(rr => opts.evalExpr(spec.expr ?? { "@var": "_row" }, rr));
          obj[alias] = runAgg(spec.agg, values);
        } else obj[alias] = opts.evalExpr(spec, rows[0] ?? {});
      }
      rows = [obj];
    } else {
      const out: Rows = [];
      for (const r of rows) {
        const obj: Binding = {};
        for (const item of sel) {
          if (typeof item === "string") obj[item.slice(1)] = r[item.slice(1)];
          else {
            const [alias, spec] = Object.entries(item)[0]!;
            if (typeof spec === "string" && spec.startsWith("?")) obj[alias] = r[spec.slice(1)];
            else obj[alias] = opts.evalExpr(spec, r);
          }
        }
        out.push(obj);
      }
      rows = out;
    }
  }

  if (q.orderBy && q.orderBy.length) {
    for (let i = q.orderBy.length - 1; i >= 0; i--) {
      const part = q.orderBy[i]!;
      const [dir, v] = part.startsWith("desc ") ? ["desc", part.slice(5)] : part.startsWith("asc ") ? ["asc", part.slice(4)] : ["asc", part];
      const varName = v.trim().replace(/^\?/, "");
      rows.sort((a, b) => {
        const av = a[varName] as any; const bv = b[varName] as any;
        if (av === bv) return 0; return (av < bv ? -1 : 1) * (dir === "desc" ? -1 : 1);
      });
    }
  }

  if (q.limit !== undefined) rows = rows.slice(0, q.limit);
  return rows;
}

// helpers
function match(store: QuadStore, s?: string, p?: string, o?: unknown) {
  return store.match(s, p, o as any, undefined).map(q => ({ s: q.s, p: q.p, o: q.o }));
}
function eq(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function truthy(x: unknown) { return !!x && x !== false; }
function groupBy<T>(rows: T[], keyFn: (t: T) => string): Map<string, T[]> { const m = new Map<string, T[]>(); for (const r of rows) { const k = keyFn(r); const arr = m.get(k); if (arr) arr.push(r); else m.set(k, [r]); } return m; }
function includesAll(extended: Binding, base: Binding): boolean { for (const k of Object.keys(base)) { if (extended[k] !== base[k]) return false; } return true; }
function isAggSpec(x: any): x is { agg: "sum"|"count"|"min"|"max"|"avg"; expr?: unknown } { return x && typeof x === "object" && typeof x.agg === "string"; }
function runAgg(kind: "sum"|"count"|"min"|"max"|"avg", vals: unknown[]) { switch (kind) { case "sum": return vals.reduce((a: number, b: any) => a + Number(b ?? 0), 0); case "count": return vals.length; case "min": return vals.reduce((m: number, v: any) => Math.min(m, Number(v)), +Infinity); case "max": return vals.reduce((m: number, v: any) => Math.max(m, Number(v)), -Infinity); case "avg": return vals.length ? (vals.reduce((a: number, b: any) => a + Number(b ?? 0), 0) / vals.length) : 0; } }
function bindOf(term: Term, row: Binding): Iri | unknown | undefined { if (isVar(term)) return row[term.var]; if (isIri(term)) return term.iri; if (isLit(term)) return term.lit; return undefined; }
function varsIn(patterns: TriplePattern[]): string[] { const vs = new Set<string>(); for (const t of patterns) { if (isVar(t.s)) vs.add(t.s.var); if (isVar(t.o)) vs.add(t.o.var); if (!isA(t.p) && isVar(t.p as any)) vs.add((t.p as any).var); } return [...vs]; }
