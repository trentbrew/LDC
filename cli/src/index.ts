#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { InMemoryQuadStore, UnitGraph } from "@ldc/jsonld";
import { CoreEvaluator as Evaluator } from "@ldc/core";

function usage() {
  console.log("ldc <command> <file> [--now ISO]");
  console.log("commands: validate | eval | view | explain");
}

async function main() {
  const [cmd, file, ...rest] = process.argv.slice(2);
  if (!cmd || !file) return usage();
  const args = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) args.set(rest[i], rest[i + 1]);
  const now = args.get("--now");
  const only = args.get("--only");
  const jsonFlag = args.has("--json");

  let doc: any = undefined;
  let evaluator: any = undefined;
  let units: any = undefined;
  if (cmd !== "test") {
    const path = resolve(process.cwd(), file);
    doc = JSON.parse(readFileSync(path, "utf8"));
    const quads = new InMemoryQuadStore();
    units = new UnitGraph((doc["@units"]) ?? {});
    const caps = {};
    evaluator = new Evaluator(() => ({ quads, units, caps, now }));
  }

  if (cmd === "validate" || cmd === "eval" || cmd === "view") {
    const { graph, diagnostics } = await evaluator.evalDocument(doc, now ? { now } : undefined);
    const out = graphToJson(doc, graph);
    const payload = { jsonld: out, diagnostics };
    console.log(JSON.stringify(payload, null, 2));
  } else if (cmd === "explain") {
    const node = evaluator.explain("root", []);
    console.log(JSON.stringify(node, null, 2));
  } else if (cmd === "test") {
    const pattern = file; // allow `ldc test ldc/tests` or specific dir
    const passed = await runTests(pattern, only ?? undefined);
    process.exit(passed ? 0 : 1);
  } else {
    usage();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

type Quad = { s: string; p: string; o: string; g?: string };
function graphToJson(inputDoc: any, store: { match: (s?: string, p?: string, o?: string, g?: string) => Quad[] }) {
  const subject = toSubject(inputDoc);
  const out: any = { "@id": subject };
  for (const q of store.match(subject, undefined, undefined, undefined)) {
    out[q.p] = parseObject(q.o);
  }
  return out;
}

function toSubject(doc: any): string {
  const ctx = doc["@context"] ?? {};
  const id = doc["@id"] ?? "";
  return expandIri(id, ctx);
}

function expandIri(curieOrIri: string, ctxMap: Record<string, string>): string {
  if (!curieOrIri) return curieOrIri;
  if (curieOrIri.startsWith("http")) return curieOrIri;
  const m = curieOrIri.match(/^([^:]+):(.+)$/);
  if (m) {
    const base = ctxMap[m[1]] ?? "";
    return joinIri(base, m[2]);
  }
  const key = Object.keys(ctxMap)[0];
  const base = key ? ctxMap[key] : "";
  return joinIri(base, curieOrIri);
}

function joinIri(base: string, suffix: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const s = suffix.startsWith("/") ? suffix.slice(1) : suffix;
  return `${b}/${s}`;
}

function parseObject(o: string): any {
  // best-effort: number, boolean, or keep string
  if (o === "true") return true;
  if (o === "false") return false;
  if (!isNaN(Number(o))) return Number(o);
  return o;
}

// (imports consolidated above)

async function runTests(root: string, only?: string): Promise<boolean> {
  let dirs = listTestDirs(root);
  if (only) dirs = dirs.filter((d) => basename(d).includes(only));
  let allPass = true;
  for (const d of dirs) {
    const inp = JSON.parse(readFileSync(join(d, "input.jsonld"), "utf8"));
    const exp = JSON.parse(readFileSync(join(d, "expected.jsonld"), "utf8"));
    const ed = JSON.parse(readFileSync(join(d, "diagnostics.json"), "utf8"));
    const quads = new InMemoryQuadStore();
    const units = new UnitGraph(inp["@units"] ?? {});
    const caps = {};
    const evaluator = new Evaluator(() => ({ quads, units, caps }));
    const { graph, diagnostics } = await evaluator.evalDocument(inp);
    const out = graphToJson(inp, graph);
    const ok = deepEqual(exp, out) && deepEqual(ed, diagnostics);
    console.log(`${basename(d)}: ${ok ? "OK" : "FAIL"}`);
    if (!ok) {
      allPass = false;
      if (!deepEqual(exp, out)) {
        console.log(" expected:", JSON.stringify(exp));
        console.log("      got:", JSON.stringify(out));
      }
      if (!deepEqual(ed, diagnostics)) {
        console.log(" diag exp:", JSON.stringify(ed));
        console.log(" diag got:", JSON.stringify(diagnostics));
      }
    }
  }
  return allPass;
}

function listTestDirs(root: string): string[] {
  const s = statSync(root);
  if (!s.isDirectory()) return [];
  const children = readdirSync(root).map((x) => join(root, x)).filter((p) => statSync(p).isDirectory());
  // leaf directories contain input.jsonld
  const leafs: string[] = [];
  for (const c of children) {
    const files = readdirSync(c);
    if (files.includes("input.jsonld")) leafs.push(c);
    else leafs.push(...listTestDirs(c));
  }
  return leafs;
}

function deepEqual(a: any, b: any): boolean { return JSON.stringify(a) === JSON.stringify(b); }
