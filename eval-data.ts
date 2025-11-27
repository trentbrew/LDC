#!/usr/bin/env bun
/**
 * eval-data.ts - Evaluate *.data files using @ldc/runtime
 *
 * Usage:
 *   bun eval-data.ts <file.data>
 *   bun eval-data.ts <file.data> --watch
 *   bun eval-data.ts <file.data> --json
 */

import { readFileSync, watchFile } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Evaluator } from './core/runtime/src/core/evaluator';
import type {
  QuadStore,
  Quad,
  Diagnostic,
} from './core/runtime/src/core/types';

// Simple in-memory QuadStore
class SimpleQuadStore implements QuadStore {
  private quads: Quad[] = [];

  add(q: Quad): void {
    this.quads.push(q);
  }

  addAll(qs: Quad[]): void {
    this.quads.push(...qs);
  }

  match(s?: string, p?: string, o?: string, g?: string): Quad[] {
    return this.quads.filter(
      (q) =>
        (!s || q.s === s) &&
        (!p || q.p === p) &&
        (!o || q.o === o) &&
        (!g || q.g === g),
    );
  }

  size(): number {
    return this.quads.length;
  }

  all(): Quad[] {
    return [...this.quads];
  }
}

// Simple unit registry (stub for now)
const stubUnits = {
  getUnit: (name: string) => {
    // Common units
    const units: Record<string, any> = {
      USD: {
        name: 'USD',
        dim: { currency: 1 },
        toBase: (x: number) => x,
        fromBase: (x: number) => x,
      },
      EUR: {
        name: 'EUR',
        dim: { currency: 1 },
        toBase: (x: number) => x * 1.1,
        fromBase: (x: number) => x / 1.1,
      },
      m: {
        name: 'm',
        dim: { length: 1 },
        toBase: (x: number) => x,
        fromBase: (x: number) => x,
      },
      km: {
        name: 'km',
        dim: { length: 1 },
        toBase: (x: number) => x * 1000,
        fromBase: (x: number) => x / 1000,
      },
      s: {
        name: 's',
        dim: { time: 1 },
        toBase: (x: number) => x,
        fromBase: (x: number) => x,
      },
      h: {
        name: 'h',
        dim: { time: 1 },
        toBase: (x: number) => x * 3600,
        fromBase: (x: number) => x / 3600,
      },
    };
    return units[name];
  },
  listUnits: () => ['USD', 'EUR', 'm', 'km', 's', 'h'],
};

interface EvalResult {
  input: any;
  output: Record<string, any>;
  diagnostics: Diagnostic[];
  quads: Quad[];
  durationMs: number;
}

// Parse rollup shorthand: "relation.property.select:aggregate"
function parseRollupShorthand(shorthand: string): {
  relation: string;
  property: string;
  select?: string;
  aggregate: string;
} {
  const [path, aggregate] = shorthand.split(':');
  const parts = path.split('.');

  if (parts.length === 2) {
    // "relation.property:aggregate" (no select, e.g., count)
    return { relation: parts[0], property: parts[1], aggregate };
  } else if (parts.length >= 3) {
    // "relation.property.select:aggregate"
    return {
      relation: parts[0],
      property: parts[1],
      select: parts.slice(2).join('.'),
      aggregate,
    };
  }
  throw new Error(`Invalid rollup shorthand: ${shorthand}`);
}

// Aggregation functions
const aggregators: Record<string, (values: any[]) => any> = {
  sum: (vals) => vals.reduce((a, b) => a + (Number(b) || 0), 0),
  avg: (vals) =>
    vals.length
      ? vals.reduce((a, b) => a + (Number(b) || 0), 0) / vals.length
      : 0,
  count: (vals) => vals.length,
  min: (vals) => Math.min(...vals.map(Number).filter((n) => !isNaN(n))),
  max: (vals) => Math.max(...vals.map(Number).filter((n) => !isNaN(n))),
  first: (vals) => vals[0],
  last: (vals) => vals[vals.length - 1],
  concat: (vals) => vals.join(', '),
  unique: (vals) => [...new Set(vals)],
  all: (vals) => vals,
};

// Load and cache related files
function loadRelations(
  relations: Record<string, string>,
  baseDir: string,
): Record<string, any> {
  const loaded: Record<string, any> = {};
  for (const [alias, relPath] of Object.entries(relations)) {
    const fullPath = resolve(baseDir, relPath);
    const content = readFileSync(fullPath, 'utf8');
    loaded[alias] = JSON.parse(content);
  }
  return loaded;
}

// Resolve a path like "relation.property.nested[0].field"
function resolvePath(path: string, relations: Record<string, any>): any {
  // Parse path: "relation.path.to.value" or "relation.items[0].name"
  const parts = path.split('.');
  const relationName = parts[0];

  const relatedDoc = relations[relationName];
  if (!relatedDoc) {
    throw new Error(`Relation "${relationName}" not found`);
  }

  let current: any = relatedDoc;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];

    // Check for array index: "items[0]" or just "items"
    const indexMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (indexMatch) {
      const [, prop, idx] = indexMatch;
      current = current?.[prop]?.[Number(idx)];
    } else {
      current = current?.[part];
    }

    if (current === undefined) {
      return undefined;
    }
  }

  return current;
}

// Process @ref properties (simple lookups)
function processRefs(
  doc: any,
  relations: Record<string, any>,
): Record<string, any> {
  const computed: Record<string, any> = {};

  for (const [key, value] of Object.entries(doc)) {
    if (value && typeof value === 'object' && '@ref' in value) {
      const refPath = (value as any)['@ref'] as string;
      computed[key] = resolvePath(refPath, relations);
    }
  }

  return computed;
}

// Process @rollup properties
function processRollups(
  doc: any,
  relations: Record<string, any>,
): Record<string, any> {
  const computed: Record<string, any> = {};

  for (const [key, value] of Object.entries(doc)) {
    if (value && typeof value === 'object' && '@rollup' in value) {
      const rollupDef = (value as any)['@rollup'];

      let config: {
        relation: string;
        property: string;
        select?: string;
        aggregate: string;
        filter?: string;
      };

      if (typeof rollupDef === 'string') {
        config = parseRollupShorthand(rollupDef);
      } else {
        config = rollupDef;
      }

      // Get the related data
      const relatedDoc = relations[config.relation];
      if (!relatedDoc) {
        throw new Error(`Relation "${config.relation}" not found`);
      }

      // Get the property (array of items)
      let items = relatedDoc[config.property];
      if (!Array.isArray(items)) {
        throw new Error(`Property "${config.property}" is not an array`);
      }

      // Apply filter if specified
      if (config.filter) {
        // Simple filter evaluation (for MVP, just support basic comparisons)
        items = items.filter((item: any) => {
          // Parse simple filter like "status == 'active'" (match multi-char ops first)
          const match = config.filter!.match(
            /(\w+)\s*(==|!=|>=|<=|>|<)\s*['"]?([^'"]+)['"]?/,
          );
          if (match) {
            const [, prop, op, val] = match;
            const itemVal = item[prop];
            switch (op) {
              case '==':
                return String(itemVal) === val;
              case '!=':
                return String(itemVal) !== val;
              case '>':
                return Number(itemVal) > Number(val);
              case '<':
                return Number(itemVal) < Number(val);
              case '>=':
                return Number(itemVal) >= Number(val);
              case '<=':
                return Number(itemVal) <= Number(val);
            }
          }
          return true;
        });
      }

      // Extract values to aggregate
      let values: any[];
      if (config.select) {
        values = items.map((item: any) => item[config.select!]);
      } else {
        values = items;
      }

      // Apply aggregation
      const aggregator = aggregators[config.aggregate];
      if (!aggregator) {
        throw new Error(`Unknown aggregation: ${config.aggregate}`);
      }

      computed[key] = aggregator(values);
    }
  }

  return computed;
}

async function evalDataFile(filePath: string): Promise<EvalResult> {
  const t0 = performance.now();
  const baseDir = dirname(filePath);

  // Read and parse file
  const content = readFileSync(filePath, 'utf8');
  const doc = JSON.parse(content);

  // Load relations if present
  const relations = doc['@relations']
    ? loadRelations(doc['@relations'], baseDir)
    : {};

  // Process @ref lookups
  const refValues = processRefs(doc, relations);

  // Process @rollup aggregations
  const rollupValues = processRollups(doc, relations);

  // Create a modified doc with ref and rollup values as plain properties
  const processedDoc = { ...doc };
  for (const [key, value] of Object.entries(refValues)) {
    processedDoc[key] = value;
  }
  for (const [key, value] of Object.entries(rollupValues)) {
    processedDoc[key] = value;
  }

  // Create evaluator with fresh context
  const quads = new SimpleQuadStore();
  const evaluator = new Evaluator(() => ({
    quads,
    units: stubUnits,
    caps: {},
    now: new Date().toISOString(),
  }));

  // Evaluate document
  const { graph, diagnostics } = await evaluator.evalDocument(processedDoc);

  // Extract computed values from quads
  const subject = expandIri(doc['@id'] ?? '', doc['@context'] ?? {});
  const output: Record<string, any> = { '@id': subject };

  // Include ref and rollup values in output
  for (const [key, value] of Object.entries(refValues)) {
    output[key] = value;
  }
  for (const [key, value] of Object.entries(rollupValues)) {
    output[key] = value;
  }

  for (const q of quads.match(subject)) {
    output[q.p] = parseValue(q.o);
  }

  const t1 = performance.now();

  return {
    input: doc,
    output,
    diagnostics,
    quads: quads.all(),
    durationMs: t1 - t0,
  };
}

function expandIri(curieOrIri: string, ctxMap: Record<string, string>): string {
  if (!curieOrIri) return curieOrIri;
  if (curieOrIri.startsWith('http')) return curieOrIri;
  const m = curieOrIri.match(/^([^:]+):(.+)$/);
  if (m) {
    const base = ctxMap[m[1]] ?? '';
    return base.endsWith('/') ? base + m[2] : base + '/' + m[2];
  }
  return curieOrIri;
}

function parseValue(o: string): any {
  if (o === 'true') return true;
  if (o === 'false') return false;
  const n = Number(o);
  if (!isNaN(n) && o.trim() !== '') return n;
  return o;
}

function formatDiagnostics(diags: Diagnostic[]): string {
  if (diags.length === 0) return '  (none)';
  return diags.map((d) => `  [${d.code}] ${d.path ?? ''}`).join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const watchMode = args.includes('--watch');
  const jsonMode = args.includes('--json');

  if (!file) {
    console.log('Usage: bun eval-data.ts <file.data> [--watch] [--json]');
    console.log('');
    console.log('Options:');
    console.log('  --watch  Re-evaluate on file changes');
    console.log('  --json   Output raw JSON result');
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), file);

  const runEval = async () => {
    try {
      const result = await evalDataFile(filePath);

      if (jsonMode) {
        console.log(
          JSON.stringify(
            {
              output: result.output,
              diagnostics: result.diagnostics,
              perf: { durationMs: result.durationMs },
            },
            null,
            2,
          ),
        );
      } else {
        console.log('\n' + '='.repeat(60));
        console.log(`📄 ${file}`);
        console.log('='.repeat(60));
        console.log('\n📊 Computed Values:');
        for (const [k, v] of Object.entries(result.output)) {
          if (k === '@id') continue;
          console.log(`  ${k}: ${JSON.stringify(v)}`);
        }
        console.log('\n🔍 Diagnostics:');
        console.log(formatDiagnostics(result.diagnostics));
        console.log(`\n⏱️  Evaluated in ${result.durationMs.toFixed(2)}ms`);
        console.log('');
      }
    } catch (e: any) {
      console.error(`❌ Error: ${e.message}`);
      if (!watchMode) process.exit(1);
    }
  };

  await runEval();

  if (watchMode) {
    console.log(`👀 Watching ${file} for changes...`);
    watchFile(filePath, { interval: 500 }, async () => {
      console.log('\n🔄 File changed, re-evaluating...');
      await runEval();
    });
  }
}

main();
