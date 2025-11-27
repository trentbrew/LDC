// Core contracts and minimal types for the MVP
import DecimalJs from "decimal.js";
export type Decimal = DecimalJs;
export { DecimalJs as DecimalClass };

export type Dim = Record<string, number>;

export type Unit = {
  name: string;
  dim: Dim;
  toBase: (x: Decimal | number) => Decimal | number;
  fromBase: (x: Decimal | number) => Decimal | number;
};

export type Quantity = { n: Decimal | number; unit: Unit };

export interface Diagnostic {
  code: string;
  msg?: string;
  nodeId?: string;
  path?: string;
  level?: "info" | "warn" | "error";
}

export type JsonLd = unknown;

export interface Quad {
  s: string;
  p: string;
  o: string;
  g?: string;
}

export interface QuadStore {
  add(q: Quad): void;
  addAll(qs: Quad[]): void;
  match(s?: string, p?: string, o?: string, g?: string): Quad[];
  size(): number;
}

export interface CapabilitySet {
  // Reserved for future capabilities (e.g., @fetch)
}

export interface UnitGraph {
  getUnit(name: string): Unit | undefined;
  listUnits(): string[];
}

export interface EvalParams {
  [k: string]: unknown;
}

export interface EvalCtx {
  quads: QuadStore;
  units: UnitGraph;
  caps: CapabilitySet;
  now?: string;
}

export interface ExplanationNode {
  id: string;
  kind: string;
  inputs: ExplanationNode[];
  detail?: string;
}

export interface Evaluator {
  evalDocument(doc: JsonLd, params?: EvalParams): Promise<{ graph: QuadStore; diagnostics: Diagnostic[] }>;
  explain(nodeId: string, path: string[]): ExplanationNode;
}
