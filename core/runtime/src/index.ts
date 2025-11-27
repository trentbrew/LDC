/**
 * @ldc/runtime - Core LD-C runtime
 * 
 * This package consolidates:
 * - Core evaluator, AST, DAG (formerly @ldc/core)
 * - JSON-LD expansion (formerly @ldc/jsonld)
 * - Standard library (formerly @ldc/stdlib)
 */

// Export core evaluator
export { Evaluator as CoreEvaluator } from './core/evaluator.js';
export type { Quad, QuadStore, Diagnostic, EvalCtx, EvalParams } from './core/types.js';

// TODO: Migrate from ldc-vscode/ldc/packages/jsonld
// export * from './jsonld';

// TODO: Migrate from ldc-vscode/ldc/packages/stdlib
// export * from './stdlib';

// Convenience exports
import { Evaluator as CoreEvaluator } from './core/evaluator.js';
import type { QuadStore, Quad } from './core/types.js';

// Simple in-memory QuadStore implementation
class SimpleQuadStore implements QuadStore {
  private quads: Quad[] = [];
  
  add(q: Quad): void {
    this.quads.push(q);
  }
  
  addAll(qs: Quad[]): void {
    this.quads.push(...qs);
  }
  
  match(s?: string, p?: string, o?: string, g?: string): Quad[] {
    return this.quads.filter(q => 
      (!s || q.s === s) &&
      (!p || q.p === p) &&
      (!o || q.o === o) &&
      (!g || q.g === g)
    );
  }
  
  size(): number {
    return this.quads.length;
  }
}

export const evaluate = async (doc: any, params?: any) => {
  const evaluator = new CoreEvaluator(() => ({
    quads: new SimpleQuadStore(),
    units: {
      getUnit: () => undefined,
      listUnits: () => []
    },
    caps: {},
    now: new Date().toISOString()
  }));
  
  return await evaluator.evalDocument(doc, params);
};

export const validate = (doc: any) => {
  // TODO: Implement validation
  if (!doc || typeof doc !== 'object') {
    return {
      valid: false,
      diagnostics: [{
        code: 'INVALID_DOC',
        message: 'Document must be an object',
        severity: 'error' as const
      }]
    };
  }
  
  return {
    valid: true,
    diagnostics: []
  };
};

export const expand = async (doc: any) => {
  // TODO: Migrate from @ldc/jsonld
  throw new Error('Not yet implemented - migrate from @ldc/jsonld');
};

export const stdlib = {
  // TODO: Export standard library functions
};
