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

        // Built-in functions ($ prefix)
        const builtins = getBuiltins();
        if (node.name in builtins) return builtins[node.name];

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
          case '&&':
            return l && r;
          case 'or':
          case '||':
            return l || r;
          default:
            throw new Error(`Unknown op ${node.op}`);
        }
      }
      case 'ternary': {
        const cond = val(node.cond, s);
        return cond ? val(node.then, s) : val(node.else, s);
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
      case 'array': {
        return node.elements.map((el) => val(el, s));
      }
      case 'object': {
        const obj: Record<string, any> = {};
        for (const prop of node.properties) {
          obj[prop.key] = val(prop.value, s);
        }
        return obj;
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
  // String concatenation takes priority
  if (typeof a === 'string' || typeof b === 'string')
    return String(a) + String(b);
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

// Built-in functions registry
function getBuiltins(): Record<string, (...args: any[]) => any> {
  return {
    // Math functions
    $sqrt: (x: number) => Math.sqrt(Number(x)),
    $abs: (x: number) => Math.abs(Number(x)),
    $round: (x: number, decimals?: number) => {
      const n = Number(x);
      if (decimals === undefined) return Math.round(n);
      const factor = Math.pow(10, decimals);
      return Math.round(n * factor) / factor;
    },
    $floor: (x: number) => Math.floor(Number(x)),
    $ceil: (x: number) => Math.ceil(Number(x)),
    $pow: (base: number, exp: number) => Math.pow(Number(base), Number(exp)),
    $log: (x: number) => Math.log(Number(x)),
    $log10: (x: number) => Math.log10(Number(x)),
    $sin: (x: number) => Math.sin(Number(x)),
    $cos: (x: number) => Math.cos(Number(x)),
    $tan: (x: number) => Math.tan(Number(x)),
    $pi: () => Math.PI,
    $e: () => Math.E,
    $random: () => Math.random(),

    // String functions
    $lower: (s: string) => String(s).toLowerCase(),
    $upper: (s: string) => String(s).toUpperCase(),
    $trim: (s: string) => String(s).trim(),
    $len: (s: string | any[]) =>
      Array.isArray(s) ? s.length : String(s).length,
    $substr: (s: string, start: number, len?: number) => {
      const str = String(s);
      return len === undefined
        ? str.substring(start)
        : str.substring(start, start + len);
    },
    $replace: (s: string, find: string, replace: string) =>
      String(s).split(find).join(replace),
    $split: (s: string, sep: string) => String(s).split(sep),
    $join: (arr: any[], sep: string) => arr.join(sep ?? ', '),
    $startsWith: (s: string, prefix: string) => String(s).startsWith(prefix),
    $endsWith: (s: string, suffix: string) => String(s).endsWith(suffix),
    $contains: (s: string, sub: string) => String(s).includes(sub),
    $padStart: (s: string, len: number, char?: string) =>
      String(s).padStart(len, char ?? ' '),
    $padEnd: (s: string, len: number, char?: string) =>
      String(s).padEnd(len, char ?? ' '),

    // Formatting functions
    $currency: (value: number, currency?: string, locale?: string) => {
      const curr = currency ?? 'USD';
      const loc = locale ?? 'en-US';
      return new Intl.NumberFormat(loc, {
        style: 'currency',
        currency: curr,
      }).format(value);
    },
    $number: (value: number, decimals?: number, locale?: string) => {
      const loc = locale ?? 'en-US';
      const opts: Intl.NumberFormatOptions =
        decimals !== undefined
          ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
          : {};
      return new Intl.NumberFormat(loc, opts).format(value);
    },
    $percent: (value: number, decimals?: number, locale?: string) => {
      const loc = locale ?? 'en-US';
      const opts: Intl.NumberFormatOptions = {
        style: 'percent',
        minimumFractionDigits: decimals ?? 0,
        maximumFractionDigits: decimals ?? 0,
      };
      return new Intl.NumberFormat(loc, opts).format(value);
    },
    $compact: (value: number, locale?: string) => {
      const loc = locale ?? 'en-US';
      return new Intl.NumberFormat(loc, { notation: 'compact' }).format(value);
    },

    // Unit conversion
    $convert: (value: number, from: string, to: string) => {
      // Temperature special cases
      if (from === 'C' && to === 'F') return (value * 9) / 5 + 32;
      if (from === 'F' && to === 'C') return ((value - 32) * 5) / 9;
      if (from === 'C' && to === 'K') return value + 273.15;
      if (from === 'K' && to === 'C') return value - 273.15;
      if (from === 'F' && to === 'K') return ((value - 32) * 5) / 9 + 273.15;
      if (from === 'K' && to === 'F') return ((value - 273.15) * 9) / 5 + 32;

      const units: Record<string, Record<string, number>> = {
        // Length (base: meters)
        m: {
          m: 1,
          km: 0.001,
          cm: 100,
          mm: 1000,
          in: 39.3701,
          ft: 3.28084,
          mi: 0.000621371,
        },
        km: { m: 1000, km: 1, cm: 100000, mm: 1000000, mi: 0.621371 },
        cm: { m: 0.01, km: 0.00001, cm: 1, mm: 10, in: 0.393701 },
        mm: { m: 0.001, cm: 0.1, mm: 1, in: 0.0393701 },
        in: { m: 0.0254, cm: 2.54, mm: 25.4, in: 1, ft: 0.0833333 },
        ft: { m: 0.3048, cm: 30.48, in: 12, ft: 1, mi: 0.000189394 },
        mi: { m: 1609.34, km: 1.60934, ft: 5280, mi: 1 },
        // Weight (base: grams)
        g: { g: 1, kg: 0.001, mg: 1000, lb: 0.00220462, oz: 0.035274 },
        kg: { g: 1000, kg: 1, lb: 2.20462, oz: 35.274 },
        mg: { g: 0.001, mg: 1 },
        lb: { g: 453.592, kg: 0.453592, lb: 1, oz: 16 },
        oz: { g: 28.3495, lb: 0.0625, oz: 1 },
        // Time (base: seconds)
        s: { s: 1, ms: 1000, min: 1 / 60, h: 1 / 3600, d: 1 / 86400 },
        ms: { s: 0.001, ms: 1 },
        min: { s: 60, ms: 60000, min: 1, h: 1 / 60, d: 1 / 1440 },
        h: { s: 3600, ms: 3600000, min: 60, h: 1, d: 1 / 24 },
        d: { s: 86400, min: 1440, h: 24, d: 1 },
        // Volume (base: liters)
        L: {
          L: 1,
          mL: 1000,
          gal: 0.264172,
          qt: 1.05669,
          pt: 2.11338,
          cup: 4.22675,
          floz: 33.814,
        },
        mL: { L: 0.001, mL: 1, floz: 0.033814 },
        gal: {
          L: 3.78541,
          mL: 3785.41,
          gal: 1,
          qt: 4,
          pt: 8,
          cup: 16,
          floz: 128,
        },
      };

      const fromUnit = units[from];
      if (!fromUnit || !fromUnit[to]) {
        throw new Error(`Cannot convert from ${from} to ${to}`);
      }
      return value * fromUnit[to];
    },

    // Date functions
    $now: () => new Date().toISOString(),
    $today: () => new Date().toISOString().split('T')[0],
    $year: (d?: string) => new Date(d ?? Date.now()).getFullYear(),
    $month: (d?: string) => new Date(d ?? Date.now()).getMonth() + 1,
    $day: (d?: string) => new Date(d ?? Date.now()).getDate(),
    $hour: (d?: string) => new Date(d ?? Date.now()).getHours(),
    $minute: (d?: string) => new Date(d ?? Date.now()).getMinutes(),
    $dayOfWeek: (d?: string) => new Date(d ?? Date.now()).getDay(),
    $timestamp: (d?: string) => new Date(d ?? Date.now()).getTime(),
    $formatDate: (d: string, fmt?: string, locale?: string) => {
      const date = new Date(d);
      const loc = locale ?? 'en-US';

      if (fmt === 'iso') return date.toISOString();
      if (fmt === 'time') return date.toLocaleTimeString(loc);
      if (fmt === 'short')
        return date.toLocaleDateString(loc, { dateStyle: 'short' });
      if (fmt === 'medium')
        return date.toLocaleDateString(loc, { dateStyle: 'medium' });
      if (fmt === 'long')
        return date.toLocaleDateString(loc, { dateStyle: 'long' });
      if (fmt === 'full')
        return date.toLocaleDateString(loc, { dateStyle: 'full' });
      if (fmt === 'relative') {
        const now = new Date();
        const diffDays = Math.floor(
          (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (diffDays === 0) return 'today';
        if (diffDays === 1) return 'yesterday';
        if (diffDays === -1) return 'tomorrow';
        if (diffDays > 0 && diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 0 && diffDays > -7) return `in ${-diffDays} days`;
        return date.toLocaleDateString(loc, { dateStyle: 'medium' });
      }
      // Default: YYYY-MM-DD
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },
    $daysBetween: (d1: string, d2: string) => {
      const date1 = new Date(d1);
      const date2 = new Date(d2);
      const diffTime = Math.abs(date2.getTime() - date1.getTime());
      return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    },
    $addDays: (d: string, days: number) => {
      const date = new Date(d);
      date.setDate(date.getDate() + days);
      return date.toISOString().split('T')[0];
    },
    $addMonths: (d: string, months: number) => {
      const date = new Date(d);
      date.setMonth(date.getMonth() + months);
      return date.toISOString().split('T')[0];
    },

    // Utility functions
    $if: (cond: boolean, then: any, else_: any) => (cond ? then : else_),
    $default: (val: any, def: any) => val ?? def,
    $coalesce: (...args: any[]) => args.find((a) => a != null),
    $type: (x: any) => {
      if (x === null) return 'null';
      if (Array.isArray(x)) return 'array';
      return typeof x;
    },
    $isNull: (x: any) => x === null || x === undefined,
    $isNumber: (x: any) => typeof x === 'number' && !isNaN(x),
    $isString: (x: any) => typeof x === 'string',
    $isBool: (x: any) => typeof x === 'boolean',
    $isArray: (x: any) => Array.isArray(x),
    $toNumber: (x: any) => Number(x),
    $toString: (x: any) => String(x),
    $toBool: (x: any) => Boolean(x),

    // Array functions
    $first: (arr: any[]) => arr?.[0],
    $last: (arr: any[]) => arr?.[arr.length - 1],
    $at: (arr: any[], idx: number) => arr?.[idx],
    $slice: (arr: any[], start: number, end?: number) => arr?.slice(start, end),
    $reverse: (arr: any[]) => [...(arr ?? [])].reverse(),
    $sort: (arr: any[]) => [...(arr ?? [])].sort(),
    $unique: (arr: any[]) => [...new Set(arr ?? [])],
    $flatten: (arr: any[]) => (arr ?? []).flat(),
    $count: (arr: any[]) => arr?.length ?? 0,
    $sum: (arr: any[]) => sumD(arr ?? []),
    $avg: (arr: any[]) => avgD(arr ?? []),
    $min: (arr: any[]) => (arr?.length ? minD(arr) : undefined),
    $max: (arr: any[]) => (arr?.length ? maxD(arr) : undefined),
  };
}
