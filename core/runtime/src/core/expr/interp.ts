import type { Expr } from './types';
import { parseExpr } from './parser';
import {
  math as stdMath,
  strings as stdStr,
  collections as stdCol,
} from '../../stdlib/index.js';
import { Decimal, D } from '../decimal';

export type Scope = Record<string, any>;

export function evalExpr(ast: Expr, scope: Scope): any {
  function val(x: Expr, s: Scope): any {
    return evalNode(x, s);
  }

  function evalNode(node: Expr, s: Scope): any {
    switch (node.t) {
      case 'num':
        return node.v;
      case 'str':
        return node.v;
      case 'bool':
        return node.v;
      case 'null':
        return null;
      case 'ident':
        if (node.name in s) {
          const v = (s as any)[node.name];
          if (v && typeof v === 'object' && '@expr' in v) return undefined;
          return v;
        }
        if ((s as any)['$this']) {
          const base = (s as any)['$this'];
          const got = getPropValue(base, node.name, s);
          if (got !== undefined) return got;
        }
        // expose stdlib at top-level (Decimal-aware where numeric)
        if (node.name === 'sum') return (xs: any[]) => sumD(xs);
        if (node.name === 'avg') return (xs: any[]) => avgD(xs);
        if (node.name === 'min') return (xs: any[]) => minD(xs);
        if (node.name === 'max') return (xs: any[]) => maxD(xs);
        return undefined;
      case 'unary': {
        const v = val(node.expr, s);
        switch (node.op) {
          case '+':
            return +v;
          case '-':
            return -v;
          case 'not':
          case '!':
            return !v;
          default:
            throw new Error(`Unknown unary ${node.op}`);
        }
      }
      case 'binary': {
        // nullish coalescing
        if (node.op === '??') {
          const l = val(node.left, s);
          return l ?? val(node.right, s);
        }
        const l = val(node.left, s);
        const r = val(node.right, s);
        switch (node.op) {
          case '+':
            return add(l, r);
          case '-':
            return sub(l, r);
          case '*':
            return mul(l, r);
          case '/':
            return div(l, r);
          case '%':
            return (l as any) % (r as any);
          case '**':
            return (l as any) ** (r as any);
          case '==':
            return eq(l, r);
          case '!=':
            return !eq(l, r);
          case '<':
            return l < r;
          case '>':
            return l > r;
          case '<=':
            return l <= r;
          case '>=':
            return l >= r;
          case 'and':
            return l && r;
          case 'or':
            return l || r;
          default:
            throw new Error(`Unknown op ${node.op}`);
        }
      }
      case 'member': {
        const obj = val(node.obj, s);
        return getPropValue(obj, node.prop, s);
      }
      case 'index': {
        const obj = val(node.obj, s);
        const idx = val(node.idx, s);
        return obj?.[idx];
      }
      case 'call': {
        const callee = val(node.callee, s);
        const owner =
          node.callee.t === 'member' ? val(node.callee.obj, s) : undefined;
        const args = node.args.map((a) => val(a, s));
        if (typeof callee === 'function') return callee.apply(owner, args);
        if (callee && typeof callee.t === 'function' && callee.call)
          return callee.call(owner, ...args);
        throw new Error('Attempted to call non-function');
      }
      case 'lambda': {
        return (...args: any[]) => {
          const inner: Scope = Object.create(s);
          node.params.forEach((p, i) => (inner[p] = args[i]));
          return evalNode(node.body, inner);
        };
      }
    }
  }

  return evalNode(ast, scope);
}

function eq(a: any, b: any) {
  // shallow equality for MVP
  return a === b;
}

function add(a: any, b: any) {
  if (isQty(a) && isQty(b)) return qtyAdd(a, b);
  if (isQty(a) && typeof b === 'number')
    return { ...a, n: D(a.n as any).add(b) } as any;
  if (typeof a === 'number' && isQty(b))
    return { ...b, n: D(a).add(b.n as any) } as any;
  if (isDecimal(a) || isDecimal(b)) return D(a).add(D(b));
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  return (a as any) + (b as any);
}
function sub(a: any, b: any) {
  if (isQty(a) && isQty(b)) return qtyAdd(a, qtyScale(b, -1));
  if (isQty(a) && typeof b === 'number')
    return { ...a, n: D(a.n as any).sub(b) } as any;
  if (typeof a === 'number' && isQty(b))
    return { ...b, n: D(a).sub(b.n as any) } as any;
  if (isDecimal(a) || isDecimal(b)) return D(a).sub(D(b));
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return (a as any) - (b as any);
}
function mul(a: any, b: any) {
  if (isQty(a) && isQty(b)) return qtyMul(a, b);
  if (isQty(a) && typeof b === 'number') return qtyScale(a, b);
  if (typeof a === 'number' && isQty(b)) return qtyScale(b, a);
  if (isDecimal(a) || isDecimal(b)) return D(a).mul(D(b));
  if (typeof a === 'number' && typeof b === 'number') return a * b;
  return (a as any) * (b as any);
}
function div(a: any, b: any) {
  if (isQty(a) && isQty(b)) return qtyMul(a, qtyPow(b, -1));
  if (isQty(a) && typeof b === 'number') return qtyScale(a, 1 / b);
  if (typeof a === 'number' && isQty(b))
    return qtyMul({ n: a, unit: unitOne }, qtyPow(b, -1));
  if (
    (isDecimal(a) || typeof a === 'number') &&
    (isDecimal(b) || typeof b === 'number')
  ) {
    const bd = D(b);
    if (bd.isZero()) throw new Error('div.by_zero');
    return D(a).div(bd);
  }
  // undefined propagates
  if (a === undefined || b === undefined) return undefined as any;
  return (a as any) / (b as any);
}

// Quantity helpers (lightweight, aligned to @ldc/core types shape)
type Unit = {
  name: string;
  dim: Record<string, number>;
  toBase: (x: number | Decimal) => number | Decimal;
  fromBase: (x: number | Decimal) => number | Decimal;
};
type Quantity = { n: number | Decimal; unit: Unit };

const unitOne: Unit = {
  name: '1',
  dim: {},
  toBase: (x) => x,
  fromBase: (x) => x,
};
const isQty = (x: any): x is Quantity =>
  x && typeof x === 'object' && 'unit' in x && 'n' in x;

function qtyScale(a: Quantity, k: number): Quantity {
  return { n: D(a.n as any).mul(k), unit: a.unit };
}

function dimAdd(a: Record<string, number>, b: Record<string, number>) {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}

function qtyMul(a: Quantity, b: Quantity): Quantity {
  // combine via base conversions
  // convert a and b to their base numeric amounts, and track dims by unit.dim exponents added
  const dim = dimAdd(a.unit.dim, b.unit.dim);
  const baseN = D(a.unit.toBase(a.n as any) as any).mul(
    D(b.unit.toBase(b.n as any) as any),
  );
  const base: Unit = {
    name: combineName(a.unit.name, b.unit.name, '*'),
    dim,
    toBase: (x) => x,
    fromBase: (x) => x,
  };
  return { n: baseN, unit: base };
}

function qtyPow(a: Quantity, e: number): Quantity {
  const dim: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.unit.dim)) dim[k] = v * e;
  const baseN = D(a.unit.toBase(a.n as any) as any).pow(e);
  const base: Unit = {
    name: `${a.unit.name}^${e}`,
    dim,
    toBase: (x) => x,
    fromBase: (x) => x,
  };
  return { n: baseN, unit: base };
}

function qtyAdd(a: Quantity, b: Quantity): Quantity {
  // convert b to a's base dim; require identical dims
  if (!sameDim(a.unit.dim, b.unit.dim))
    throw new Error('Incompatible units for addition');
  const baseN = D(a.unit.toBase(a.n as any) as any).add(
    D(b.unit.toBase(b.n as any) as any),
  );
  const base: Unit = {
    name: a.unit.name,
    dim: a.unit.dim,
    toBase: (x) => x,
    fromBase: (x) => x,
  };
  return { n: baseN, unit: base };
}

function sameDim(a: Record<string, number>, b: Record<string, number>) {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++)
    if (ak[i] !== bk[i] || a[ak[i]] !== b[bk[i]]) return false;
  return true;
}

function combineName(a: string, b: string, op: string) {
  return `${a}${op}${b}`;
}

function getPropValue(obj: any, prop: string, s: Scope): any {
  if (!obj) return undefined;
  const cacheKey = '__ldc_cache';
  if (!Object.prototype.hasOwnProperty.call(obj, cacheKey)) {
    Object.defineProperty(obj, cacheKey, {
      value: Object.create(null),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  const cache = obj[cacheKey] as Record<string, any>;
  if (prop in cache) return cache[prop];
  const v = obj[prop];
  if (v && typeof v === 'object' && '@expr' in v) {
    const ast = parseExpr((v as any)['@expr']);
    const inner: Scope = Object.create(s);
    inner['$this'] = obj;
    const res = evalExpr(ast, inner);
    cache[prop] = res;
    return res;
  }
  cache[prop] = v;
  return v;
}

function isDecimal(x: any): x is Decimal {
  return x instanceof Decimal;
}

function sumD(xs: any[]): any {
  if (!xs.length) return 0;
  if (xs.some(isDecimal))
    return xs.reduce((a: Decimal, b: any) => a.add(D(b)), D(0));
  return xs.reduce((a: number, b: any) => a + Number(b ?? 0), 0);
}
function avgD(xs: any[]): any {
  return !xs.length
    ? 0
    : isDecimal(xs[0])
      ? (sumD(xs) as Decimal).div(xs.length)
      : (sumD(xs) as number) / xs.length;
}
function minD(xs: any[]): any {
  return xs.reduce((m: any, v: any) =>
    isDecimal(m) || isDecimal(v) ? (D(m).lt(D(v)) ? m : v) : m < v ? m : v,
  );
}
function maxD(xs: any[]): any {
  return xs.reduce((m: any, v: any) =>
    isDecimal(m) || isDecimal(v) ? (D(m).gt(D(v)) ? m : v) : m > v ? m : v,
  );
}
