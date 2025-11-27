import {
  type EvalCtx,
  type Evaluator as IEvaluator,
  type EvalParams,
  type JsonLd,
  type Diagnostic,
} from './types';
import { buildDag, topoSort, type DagNode } from './dag';
import { parseExpr } from './expr/parser';
import { evalExpr } from './expr/interp';
// local quantity literal parsing (to avoid cross-package deps)
import { runQuery, type LdcQuery, type Binding } from './query';
import { Decimal, D, truncateTo } from './decimal';

export class Evaluator implements IEvaluator {
  constructor(private mkCtx: () => EvalCtx) {}

  async evalDocument(
    _doc: JsonLd,
    _params?: EvalParams,
  ): Promise<{ graph: EvalCtx['quads']; diagnostics: Diagnostic[] }> {
    const ctx = this.mkCtx();
    const { subject, env, nodes } = indexComputations(_doc as any, ctx);
    const state: Record<string, any> = { ...env };
    const dag = buildDag(nodes);
    const order = topoSort(dag, { allowFixpoint: true });
    const diagnostics: Diagnostic[] = [];

    for (const layer of order.layers) {
      if (layer.fixpoint) {
        let changed = false;
        for (let iter = 0; iter < 10; iter++) {
          changed =
            this.evalLayer(layer.nodes, ctx, subject, state, diagnostics) ||
            changed;
          if (!changed) break;
          changed = false;
        }
      } else {
        this.evalLayer(layer.nodes, ctx, subject, state, diagnostics);
      }
    }

    return { graph: ctx.quads, diagnostics };
  }

  explain(nodeId: string, path: string[]) {
    return { id: nodeId, kind: 'explain', inputs: [], detail: path.join('/') };
  }

  private evalLayer(
    nodes: DagNode[],
    ctx: EvalCtx,
    subject: string,
    state: Record<string, any>,
    diags: Diagnostic[],
  ): boolean {
    let changed = false;
    for (const n of nodes) {
      const plainKey = (n as any).plainKey as string | undefined;
      if ((n as any).expr) {
        try {
          const ast = (n as any).exprAst;
          const v = evalExpr(ast, state);
          const stateKey = plainKey ?? n.writes[0];
          if (!deepEqual(v, state[stateKey])) {
            // Store under plain key for downstream expressions
            if (plainKey) state[plainKey] = v;
            state[n.writes[0]] = v;
            // materialize to quads - use node id (expanded IRI) as predicate
            const pred = n.id;
            const obj = serializeValue(v, ctx);
            if (obj !== undefined)
              ctx.quads.add({ s: subject, p: pred, o: obj });
            changed = true;
          }
        } catch (e) {
          diags.push({ code: 'LDC_EXPR_ERR', path: n.id });
        }
      } else if ((n as any).constraint) {
        try {
          const ast = (n as any).exprAst;
          const v = evalExpr(ast, state);
          if (!v) diags.push({ code: 'LDC_CONSTRAINT_FAILED', path: n.id });
        } catch (e) {
          diags.push({ code: 'LDC_CONSTRAINT_FAILED', path: n.id });
        }
      } else if ((n as any).view) {
        try {
          const ast = (n as any).exprAst;
          const v = evalExpr(ast, state);
          // Store under plain key for downstream expressions
          if (plainKey) state[plainKey] = v;
          const pred = n.writes[0];
          const obj = serializeValue(v, ctx);
          if (obj !== undefined) ctx.quads.add({ s: subject, p: pred, o: obj });
          changed = true;
        } catch (e) {
          diags.push({ code: 'LDC_EXPR_ERR', path: n.id });
        }
      } else if ((n as any).query) {
        try {
          const qAst = (n as any).queryAst as LdcQuery;
          const rows = runQuery(ctx.quads as any, qAst, {
            evalExpr: (expr: unknown, scope: Binding) =>
              evalQueryExpr(expr, scope),
          });
          // materialize first row, first key
          const first = rows[0] ?? {};
          const keys = Object.keys(first);
          if (keys.length) {
            const v = first[keys[0] as any];
            const pred = n.writes[0];
            const obj = serializeValue(v, ctx);
            if (obj !== undefined)
              ctx.quads.add({ s: subject, p: pred, o: obj });
            changed = true;
          }
        } catch (e) {
          diags.push({ code: 'LDC_EXPR_ERR', path: n.id });
        }
      }
    }
    return changed;
  }
}

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function serializeValue(v: any, ctx: EvalCtx): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Decimal) return v.toString();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'unit' in v && 'n' in v) {
    // Quantity -> try to reduce dimensions; if only currency dimension remain, format "n UNIT"
    const unit = (v as any).unit as {
      name: string;
      dim: Record<string, number>;
      fromBase: (x: any) => any;
    };
    // attempt to choose pretty unit: if it contains currency only
    if (Object.keys(unit.dim).length === 1 && unit.dim['currency'] === 1) {
      const n = (v as any).n;
      const dec = D(n as any);
      const pretty = truncateTo(dec, 5).toFixed(5);
      const code =
        unit.name.includes('/') || unit.name.includes('*')
          ? primaryCurrencyUnitName(ctx)
          : unit.name;
      return `${pretty} ${code}`;
    }
    return `${D((v as any).n).toString()} ${unit.name}`;
  }
  return undefined;
}

function primaryCurrencyUnitName(ctx: EvalCtx): string {
  for (const name of ctx.units.listUnits()) {
    const u = ctx.units.getUnit(name);
    if (u && u.dim['currency'] === 1 && Object.keys(u.dim).length === 1)
      return u.name;
  }
  return 'USD';
}

function indexComputations(
  doc: any,
  ctx: EvalCtx,
): { subject: string; env: Record<string, any>; nodes: DagNode[] } {
  const ctxMap = doc['@context'] ?? {};
  const subject = expandIri(doc['@id'], ctxMap);
  const env: Record<string, any> = {};
  // seed env with simple values and parsed quantities
  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith('@')) continue;
    if (typeof v === 'string') {
      const q = parseQuantityLiteralLocal(v, ctx.units);
      env[k] = q ?? v;
    } else {
      env[k] = v;
    }
  }
  // Seed quads from plain values to support queries
  seedQuadsFromDoc(subject, doc, ctxMap, ctx);

  const nodes: DagNode[] = [];
  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith('@')) continue;
    if (v && typeof v === 'object' && '@expr' in (v as any)) {
      const expr = (v as any)['@expr'] as string;
      const ast = parseExpr(expr);
      const pred = expandIri(k, ctxMap);
      // Keep plain key reads for state lookup (expressions use plain keys)
      const reads = collectReads(ast);
      // Include plain key in writes for DAG dependency matching
      nodes.push({
        id: pred,
        kind: 'expr',
        reads,
        writes: [k, pred],
        plainKey: k,
        expr,
        exprAst: ast,
      } as any);
    } else if (v && typeof v === 'object' && '@query' in (v as any)) {
      const q = normalizeQuery((v as any)['@query'], ctxMap);
      const pred = expandIri(k, ctxMap);
      const reads = predicatesOf(q).map((p) => expandIri(p, ctxMap));
      nodes.push({
        id: pred,
        kind: 'query',
        reads,
        writes: [pred],
        plainKey: k,
        query: true,
        queryAst: q,
      } as any);
    } else if (v && typeof v === 'object' && '@constraint' in (v as any)) {
      const expr = (v as any)['@constraint'] as string;
      const ast = parseExpr(expr);
      const pred = expandIri(k, ctxMap);
      // Keep plain key reads for state lookup
      const reads = collectReads(ast);
      nodes.push({
        id: pred,
        kind: 'constraint',
        reads,
        writes: [],
        plainKey: k,
        constraint: true,
        exprAst: ast,
      } as any);
    } else if (v && typeof v === 'object' && '@view' in (v as any)) {
      const viewDef = (v as any)['@view'] as any;
      const expr = viewDef['@expr'] as string;
      const ast = parseExpr(expr);
      const pred = expandIri(k, ctxMap);
      // Keep plain key reads for state lookup
      const reads = collectReads(ast);
      nodes.push({
        id: pred,
        kind: 'view',
        reads,
        writes: [k, pred],
        plainKey: k,
        view: true,
        exprAst: ast,
        stable: !!viewDef['@stable'],
      } as any);
    }
  }

  return { subject, env, nodes };
}

function expandIri(curieOrIri: string, ctxMap: Record<string, string>): string {
  if (!curieOrIri) return curieOrIri;
  if (curieOrIri.startsWith('http')) return curieOrIri;
  const m = curieOrIri.match(/^([^:]+):(.+)$/);
  if (m) {
    const base = ctxMap[m[1]] ?? '';
    return joinIri(base, m[2]);
  }
  // plain key: assume default context key is first entry
  const key = Object.keys(ctxMap)[0];
  const base = key ? ctxMap[key] : '';
  return joinIri(base, curieOrIri);
}

function joinIri(base: string, suffix: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const s = suffix.startsWith('/') ? suffix.slice(1) : suffix;
  return `${b}/${s}`;
}

// Collect variable reads from AST, ignoring identifiers bound by lambdas
import type { Expr as Ast } from './expr/types';
function collectReads(ast: Ast): string[] {
  const reads = new Set<string>();
  const bound: Set<string> = new Set();
  function walk(n: Ast) {
    switch (n.t) {
      case 'ident':
        if (!bound.has(n.name)) reads.add(n.name);
        break;
      case 'binary':
        walk(n.left);
        walk(n.right);
        break;
      case 'unary':
        walk(n.expr);
        break;
      case 'member':
        walk(n.obj);
        break;
      case 'index':
        walk(n.obj);
        walk(n.idx);
        break;
      case 'call':
        walk(n.callee);
        n.args.forEach(walk);
        break;
      case 'ternary':
        walk(n.cond);
        walk(n.then);
        walk(n.else);
        break;
      case 'lambda': {
        const prev = new Set(bound);
        n.params.forEach((p) => bound.add(p));
        walk(n.body);
        bound.clear();
        prev.forEach((p) => bound.add(p));
        break;
      }
      default:
        break;
    }
  }
  walk(ast);
  return Array.from(reads);
}

function parseCompoundUnit(
  name: string,
  units: EvalCtx['units'],
):
  | {
      name: string;
      dim: Record<string, number>;
      toBase: (x: number) => number;
      fromBase: (x: number) => number;
    }
  | undefined {
  type Term = {
    unit: ReturnType<EvalCtx['units']['getUnit']> extends infer U
      ? U extends object
        ? U
        : never
      : never;
    exp: number;
  };
  const terms: Term[] = [];
  let op: '*' | '/' = '*';
  const re = /([A-Za-z_][A-Za-z0-9_]*)(\^(-?\d+))?/g;
  const parts = name
    .split(/([*/])/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (p === '*' || p === '/') {
      op = p as any;
      continue;
    }
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(p))) {
      const uname = m[1];
      const exp = m[3] ? Number(m[3]) : 1;
      const u = units.getUnit(uname);
      if (!u) return undefined;
      terms.push({ unit: u as any, exp: op === '*' ? exp : -exp });
    }
  }
  const dim: Record<string, number> = {};
  for (const t of terms)
    for (const [k, v] of Object.entries(
      (t.unit as any).dim as Record<string, number>,
    ) as [string, number][])
      dim[k] = (dim[k] ?? 0) + v * t.exp;
  return {
    name,
    dim,
    toBase: (x: number) => {
      let v = x;
      for (const t of terms)
        v =
          t.exp >= 0
            ? (t.unit as any).toBase(v)
            : 1 / (t.unit as any).toBase(1 / v);
      return v;
    },
    fromBase: (x: number) => {
      let v = x;
      for (const t of terms)
        v =
          t.exp >= 0
            ? (t.unit as any).fromBase(v)
            : 1 / (t.unit as any).fromBase(1 / v);
      return v;
    },
  };
}

function parseQuantityLiteralLocal(
  s: string,
  units: EvalCtx['units'],
):
  | {
      n: number;
      unit: {
        name: string;
        dim: Record<string, number>;
        toBase: (x: number) => number;
        fromBase: (x: number) => number;
      };
    }
  | undefined {
  const m = s.trim().match(/^(-?[0-9]+(?:\.[0-9]+)?)\s+(.+)$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  const uname = m[2];
  const u = units.getUnit(uname) ?? parseCompoundUnit(uname, units);
  if (!u) return undefined;
  return { n, unit: u as any };
}

function seedQuadsFromDoc(
  subject: string,
  doc: any,
  ctxMap: Record<string, string>,
  ctx: EvalCtx,
) {
  const addSimple = (s: string, pKey: string, o: any) => {
    const p = expandIri(pKey, ctxMap);
    if (
      typeof o === 'string' ||
      typeof o === 'number' ||
      typeof o === 'boolean'
    ) {
      ctx.quads.add({ s, p, o: String(o) });
    }
  };
  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith('@')) continue;
    if (v === null || v === undefined) continue;
    // Skip top-level primitive seeding to keep outputs stable
    // if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") addSimple(subject, k, v);
    else if (Array.isArray(v)) {
      v.forEach((it, i) => {
        if (typeof it === 'object' && it && !('@expr' in it)) {
          const sub = `${subject}/${k}/${i}`;
          for (const [kk, vv] of Object.entries(it)) addSimple(sub, kk, vv);
        } else if (typeof it !== 'object') addSimple(subject, k, it);
      });
    } else if (
      typeof v === 'object' &&
      !('@expr' in v) &&
      !('@query' in v) &&
      !('@view' in v) &&
      !('@constraint' in v)
    ) {
      const sub = `${subject}/${k}`;
      for (const [kk, vv] of Object.entries(v)) addSimple(sub, kk, vv);
    }
  }
}

function normalizeQuery(q: any, ctxMap: Record<string, string>): LdcQuery {
  const term = (t: any) => {
    if (typeof t === 'string') {
      if (t.startsWith('?')) return { var: t.slice(1) };
      if (t.startsWith('http')) return { iri: t };
      return { iri: expandIri(t, ctxMap) };
    }
    if (typeof t === 'number' || typeof t === 'boolean') return { lit: t };
    if (t && typeof t === 'object' && 'iri' in t)
      return { iri: expandIri((t as any).iri, ctxMap) };
    return { lit: t };
  };
  const patterns = (q.patterns ?? []).map((tp: any) => {
    if (tp.p === 'a' || (tp.p && tp.p.a))
      return { s: term(tp.s), p: { a: true } as any, o: term(tp.o) };
    return { s: term(tp.s), p: term(tp.p), o: term(tp.o) } as any;
  });
  const filters = q.filters ?? [];
  const select = q.select ?? [];
  const groupBy = q.groupBy ?? [];
  const orderBy = q.orderBy ?? [];
  const limit = q.limit;
  return { patterns, filters, select, groupBy, orderBy, limit };
}

function predicatesOf(q: LdcQuery): string[] {
  const out = new Set<string>();
  for (const pat of q.patterns) {
    if ((pat as any).optional) {
      for (const tp of (pat as any).optional)
        if ((tp as any).p && (tp as any).p.iri) out.add((tp as any).p.iri);
    } else {
      const tp = pat as any;
      if (tp.p && tp.p.iri) out.add(tp.p.iri);
    }
  }
  return Array.from(out);
}

function evalQueryExpr(expr: unknown, row: Binding): any {
  if (typeof expr === 'string') {
    const ast = parseExpr(expr);
    const scope: any = Object.create(null);
    for (const [k, v] of Object.entries(row)) {
      scope[k] = v;
      scope[`?${k}`] = v;
    }
    return evalExpr(ast, scope);
  }
  try {
    return evalExpr(expr as any, row as any);
  } catch {
    return undefined;
  }
}
