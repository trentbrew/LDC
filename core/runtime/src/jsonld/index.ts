import type { Quad, QuadStore as IQuadStore, JsonLd, Unit, UnitGraph as IUnitGraph, Dim, Decimal } from "../core/types.js";

export class InMemoryQuadStore implements IQuadStore {
  private qs: Quad[] = [];
  add(q: Quad): void { this.qs.push(q); }
  addAll(qs: Quad[]): void { this.qs.push(...qs); }
  match(s?: string, p?: string, o?: string, g?: string): Quad[] {
    return this.qs.filter((q) =>
      (s === undefined || q.s === s) &&
      (p === undefined || q.p === p) &&
      (o === undefined || q.o === o) &&
      (g === undefined || q.g === g)
    );
  }
  size(): number { return this.qs.length; }
}

export type UnitsSpec = Record<string, { kind: string; equals?: string }>;

type UnitEntry = Unit & { kind: string; base?: string; factor?: Decimal };

export class UnitGraph implements IUnitGraph {
  private units = new Map<string, UnitEntry>();
  constructor(spec?: UnitsSpec) { if (spec) this.load(spec); }

  load(spec: UnitsSpec) {
    for (const [name, def] of Object.entries(spec)) {
      if (def.equals) {
        const m = def.equals.trim().match(/^([0-9.]+)\s+([A-Za-z_/]+)$/);
        if (!m) continue;
        const factor = Number(m[1]);
        const baseName = m[2];
        const baseUnit = this.units.get(baseName) ?? this.defineBase(baseName, def.kind);
        this.units.set(name, this.derivedUnit(name, def.kind, baseName, factor, baseUnit.dim));
      } else {
        this.units.set(name, this.defineBase(name, def.kind));
      }
    }
  }

  private defineBase(name: string, kind: string): UnitEntry {
    const dim: Dim = { [kind]: 1 };
    const u: UnitEntry = { name, kind, dim, toBase: (x) => x, fromBase: (x) => x, base: name, factor: 1 };
    return u;
  }

  private derivedUnit(name: string, kind: string, base: string, factor: Decimal, dim: Dim): UnitEntry {
    return {
      name,
      kind,
      dim,
      base,
      factor,
      toBase: (x) => x * factor,
      fromBase: (x) => x / factor,
    };
  }

  getUnit(name: string) { return this.units.get(name); }
  listUnits() { return Array.from(this.units.keys()); }
}

export function expandJsonLd(doc: JsonLd): JsonLd {
  // Placeholder: return input as-is; integrate a real expander later.
  return doc;
}

// Helpers for unit parsing of compound units like "USD/kg" or "m/s^2"
export function parseCompoundUnit(name: string, units: UnitGraph): Unit | undefined {
  // support products and divisions with exponents like kg*m/s^2
  // tokenize by * and /, handle ^ exponents
  type Term = { unit: Unit; exp: number };
  const terms: Term[] = [];
  let op: "*" | "/" = "*";
  const re = /([A-Za-z_][A-Za-z0-9_]*)(\^(-?\d+))?/g;
  const parts = name.split(/([*/])/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (p === "*" || p === "/") { op = p as any; continue; }
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(p))) {
      const uname = m[1];
      const exp = m[3] ? Number(m[3]) : 1;
      const u = units.getUnit(uname);
      if (!u) return undefined;
      terms.push({ unit: u, exp: op === "*" ? exp : -exp });
    }
  }
  // combine dims and construct a synthetic unit that converts via base conversions
  const dim: Dim = {};
  for (const t of terms) for (const [k, v] of Object.entries(t.unit.dim)) dim[k] = (dim[k] ?? 0) + v * t.exp;
  const u: Unit = {
    name,
    dim,
    toBase: (x: Decimal) => {
      let v = x as number;
      for (const t of terms) v = t.exp >= 0 ? t.unit.toBase(v) : 1 / t.unit.toBase(1 / v);
      return v;
    },
    fromBase: (x: Decimal) => {
      let v = x as number;
      for (const t of terms) v = t.exp >= 0 ? t.unit.fromBase(v) : 1 / t.unit.fromBase(1 / v);
      return v;
    },
  };
  return u;
}

export function parseQuantityLiteral(s: string, units: UnitGraph): { n: number; unit: Unit } | undefined {
  const m = s.trim().match(/^(-?[0-9]+(?:\.[0-9]+)?)\s+(.+)$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  const uname = m[2];
  const u = units.getUnit(uname) ?? parseCompoundUnit(uname, units);
  if (!u) return undefined;
  return { n, unit: u };
}

