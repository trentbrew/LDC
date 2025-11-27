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
import { resolve } from 'node:path';
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

async function evalDataFile(filePath: string): Promise<EvalResult> {
  const t0 = performance.now();

  // Read and parse file
  const content = readFileSync(filePath, 'utf8');
  const doc = JSON.parse(content);

  // Create evaluator with fresh context
  const quads = new SimpleQuadStore();
  const evaluator = new Evaluator(() => ({
    quads,
    units: stubUnits,
    caps: {},
    now: new Date().toISOString(),
  }));

  // Evaluate document
  const { graph, diagnostics } = await evaluator.evalDocument(doc);

  // Extract computed values from quads
  const subject = expandIri(doc['@id'] ?? '', doc['@context'] ?? {});
  const output: Record<string, any> = { '@id': subject };

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
