// Export all services
export * from './greeting-service.js';

import type { AuthT, CapsT, DiagnosticT } from '../schema.js';

/**
 * Dependency injection: wire runtime, storage, signing, and policy
 * Services are environment-aware and can be swapped for testing
 */
export function makeServices() {
  // Signing service - cryptographically signs evaluation results
  const signer = {
    async sign(canonicalJson: string): Promise<string> {
      const { signHmac256, getSigningSecret, getKeyId, formatSignatureHeader } = await import('../signing.js');
      const secret = getSigningSecret();
      const keyId = getKeyId();
      const signature = signHmac256(secret, canonicalJson);
      return formatSignatureHeader(signature, keyId);
    }
  };

  // Policy service - enforces capability-based security
  const policy = {
    enforce(auth: AuthT, requestedCaps: CapsT): { allowed: CapsT; denied: string[]; audit: string[] } {
      const { enforceCaps } = require('../policy.js');
      const enforcement = enforceCaps(auth.orgId, requestedCaps);
      
      // Convert denied CapsT to string[] for backward compatibility
      const deniedKeys = Object.keys(enforcement.denied);
      
      return {
        allowed: enforcement.allowed,
        denied: deniedKeys,
        audit: enforcement.audit
      };
    }
  };

  // Runtime service - evaluates and validates LD-C documents
  const runtime = {
    async evaluate(doc: Record<string, any>, options?: any): Promise<{
      value: any;
      diagnostics: DiagnosticT[];
      prov?: Record<string, any>;
    }> {
      // Respect abort signal
      if (options?.signal?.aborted) {
        throw new Error("AbortError");
      }
      
      try {
        // Import real runtime
        const { evaluate: ldcEvaluate } = await import('../../../runtime/src/index.js');
        
        // Call real evaluator
        const result = await ldcEvaluate(doc, {
          baseIRI: options?.baseIRI ?? '',
          caps: options?.caps ?? {},
        });
        
        // Map runtime diagnostics to our format
        const diagnostics: DiagnosticT[] = (result.diagnostics || []).map((d: any) => ({
          code: d.code || 'EVAL_ERROR',
          message: d.message || String(d),
          severity: (d.severity || 'error') as 'error' | 'warning' | 'info',
          path: d.path
        }));
        
        return {
          value: result.graph || result,
          diagnostics,
          prov: { source: '@ldc/runtime', graph: result.graph }
        };
      } catch (error: any) {
        // If runtime throws, convert to diagnostic
        return {
          value: null,
          diagnostics: [{
            code: 'RUNTIME_ERROR',
            message: error.message || String(error),
            severity: 'error'
          }],
          prov: { source: '@ldc/runtime', error: true }
        };
      }
    },

    async validate(doc: Record<string, any>, options?: any): Promise<{
      value: any;
      diagnostics: DiagnosticT[];
    }> {
      // Respect abort signal
      if (options?.signal?.aborted) {
        throw new Error("AbortError");
      }
      
      try {
        // Import real runtime
        const { validate: ldcValidate } = await import('../../../runtime/src/index.js');
        
        // Call real validator
        const result = ldcValidate(doc);
        
        // Map runtime diagnostics to our format
        const diagnostics: DiagnosticT[] = (result.diagnostics || []).map((d: any) => ({
          code: d.code || 'VALIDATION_ERROR',
          message: d.message || String(d),
          severity: (d.severity || 'error') as 'error' | 'warning' | 'info',
          path: d.path
        }));
        
        return {
          value: { valid: result.valid },
          diagnostics
        };
      } catch (error: any) {
        // If validation throws, convert to diagnostic
        return {
          value: { valid: false },
          diagnostics: [{
            code: 'VALIDATION_ERROR',
            message: error.message || String(error),
            severity: 'error'
          }]
        };
      }
    }
  };

  // Storage service - manages artifacts and materializations
  const storage = {
    async listArtifacts(params: { orgId: string }): Promise<any[]> {
      // TODO: Implement artifact storage (S3, DB, etc.)
      void params;
      return [];
    },

    async getArtifact(params: { orgId: string; id: string }): Promise<any | null> {
      // TODO: Implement artifact retrieval
      void params;
      return null;
    }
  };

  return { runtime, signer, policy, storage };
}
