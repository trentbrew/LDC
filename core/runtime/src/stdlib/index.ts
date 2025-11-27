// Minimal, deterministic stdlib stubs for MVP

export const math = {
  sum: (xs: number[]) => xs.reduce((a, b) => a + b, 0),
  avg: (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0),
  min: (xs: number[]) => Math.min(...xs),
  max: (xs: number[]) => Math.max(...xs),
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  trunc: Math.trunc,
  pow: Math.pow,
  sqrt: Math.sqrt,
  clamp: (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
};

export const strings = {
  len: (s: string) => s.length,
  trim: (s: string) => s.trim(),
  to_lower: (s: string) => s.toLowerCase(),
  to_upper: (s: string) => s.toUpperCase(),
  replace: (s: string, pat: string | RegExp, rep: string) => s.replace(pat as any, rep),
  split: (s: string, sep: string | RegExp) => s.split(sep as any),
  join: (xs: string[], sep = ",") => xs.join(sep),
  starts_with: (s: string, p: string) => s.startsWith(p),
  ends_with: (s: string, p: string) => s.endsWith(p),
  contains: (s: string, p: string) => s.includes(p),
};

export const collections = {
  map: <A, B>(xs: A[], f: (a: A) => B) => xs.map(f),
  filter: <A>(xs: A[], f: (a: A) => boolean) => xs.filter(f),
  find: <A>(xs: A[], f: (a: A) => boolean) => xs.find(f),
  some: <A>(xs: A[], f: (a: A) => boolean) => xs.some(f),
  every: <A>(xs: A[], f: (a: A) => boolean) => xs.every(f),
  group_by: <A>(xs: A[], key: (a: A) => string) => {
    const m = new Map<string, A[]>();
    for (const x of xs) {
      const k = key(x);
      const arr = m.get(k) ?? [];
      arr.push(x);
      m.set(k, arr);
    }
    return m;
  },
  key_by: <A>(xs: A[], key: (a: A) => string) => Object.fromEntries(xs.map((x) => [key(x), x])),
  uniq: <A>(xs: A[]) => Array.from(new Set(xs)),
  sort_by: <A>(xs: A[], k: (a: A) => number | string) => [...xs].sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0)),
  reduce: <A, B>(xs: A[], f: (acc: B, a: A) => B, init: B) => xs.reduce(f, init),
};

