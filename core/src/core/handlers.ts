import { EvalInput, EvalOutput, type EvalInputT, type EvalOutputT, type DiagnosticT } from "./schema.js";
import { makeServices } from "./services/index.js";
import { canonicalize, createSignablePayload } from "./canonical.js";
import { randomUUID } from "crypto";

/**
 * Options for handler execution
 */
export interface HandlerOptions {
  signal?: AbortSignal;
  reqId?: string;
}

/**
 * Core evaluation handler - transport-agnostic
 * 
 * Rules:
 * - Never throws; always returns diagnostics
 * - Respects timeouts via AbortSignal
 * - Deterministic signatures (excludes perf, timestamps)
 * - Logs audit trail
 */
export async function evaluate(
  input: EvalInputT,
  opts?: HandlerOptions
): Promise<EvalOutputT> {
  const reqId = opts?.reqId ?? randomUUID();
  const started = Date.now();
  
  try {
    // Parse and validate input
    const { doc, options, auth } = EvalInput.parse(input);
    const { runtime, signer, policy } = makeServices();

    // Enforce capability-based security (default-deny + org policy)
    const capsResult = policy.enforce(auth, options?.caps ?? {});
    const caps = capsResult.allowed;
    const capsDenied = capsResult.denied;

    // Add warnings for denied capabilities
    const diagnostics: DiagnosticT[] = [];
    if (capsDenied.length > 0) {
      diagnostics.push({
        code: "cap_denied",
        message: `Capabilities denied: ${capsDenied.join(", ")}`,
        severity: "warning"
      });
    }

    // Setup timeout
    const timeoutMs = options?.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    // Merge signals if provided
    const signal = opts?.signal 
      ? AbortSignal.any([opts.signal, controller.signal])
      : controller.signal;

    try {
      // Execute evaluation with enforced capabilities
      const result = await runtime.evaluate(doc, { 
        ...options, 
        caps,
        signal 
      });

      clearTimeout(timeoutId);

      // Merge diagnostics
      diagnostics.push(...(result.diagnostics ?? []));

      // Create signable payload (excludes non-deterministic fields like timestamps)
      const signablePayload = createSignablePayload({
        doc,
        options: { ...options, caps },
        value: result.value,
        prov: result.prov,
        runtimeVersion: options?.runtimeVersion
      });

      // Sign canonical JSON (timestamp NOT included for determinism)
      const sig = await signer.sign(canonicalize(signablePayload));

      const output = {
        value: result.value,
        diagnostics,
        prov: result.prov,
        perf: { durationMs: Date.now() - started },
        sig
      };

      // Audit log
      logAudit({
        reqId,
        orgId: auth.orgId,
        userId: auth.userId,
        tool: "evaluate",
        capsEffective: Object.keys(caps),
        durationMs: output.perf.durationMs,
        diagCounts: countDiagnostics(diagnostics)
      });

      return EvalOutput.parse(output);

    } catch (error: any) {
      clearTimeout(timeoutId);

      // Handle timeout
      if (error.name === "AbortError" || signal.aborted) {
        diagnostics.push({
          code: "timeout",
          message: `Evaluation timed out after ${timeoutMs}ms`,
          severity: "error"
        });

        return {
          value: null,
          diagnostics,
          perf: { durationMs: Date.now() - started }
        };
      }

      // Handle evaluation errors
      diagnostics.push({
        code: "eval_error",
        message: error instanceof Error ? error.message : String(error),
        severity: "error"
      });

      return {
        value: null,
        diagnostics,
        perf: { durationMs: Date.now() - started }
      };
    }

  } catch (error: any) {
    // Handle schema/parsing errors
    const diagnostics: DiagnosticT[] = [{
      code: "schema_error",
      message: error instanceof Error ? error.message : String(error),
      severity: "error"
    }];

    return {
      value: null,
      diagnostics,
      perf: { durationMs: Date.now() - started }
    };
  }
}

/**
 * Core validation handler - transport-agnostic
 * 
 * Rules:
 * - Never throws; always returns diagnostics
 * - Respects timeouts via AbortSignal
 * - Logs audit trail
 */
export async function validate(
  input: EvalInputT,
  opts?: HandlerOptions
): Promise<EvalOutputT> {
  const reqId = opts?.reqId ?? randomUUID();
  const started = Date.now();

  try {
    // Parse and validate input
    const { doc, auth, options } = EvalInput.parse(input);
    const { runtime } = makeServices();

    // Setup timeout
    const timeoutMs = options?.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const signal = opts?.signal 
      ? AbortSignal.any([opts.signal, controller.signal])
      : controller.signal;

    try {
      // Execute validation
      const result = await runtime.validate(doc, { signal });

      clearTimeout(timeoutId);

      const output = {
        value: result.value,
        diagnostics: result.diagnostics ?? [],
        perf: { durationMs: Date.now() - started }
      };

      // Audit log
      logAudit({
        reqId,
        orgId: auth.orgId,
        userId: auth.userId,
        tool: "validate",
        capsEffective: [],
        durationMs: output.perf.durationMs,
        diagCounts: countDiagnostics(output.diagnostics)
      });

      return EvalOutput.parse(output);

    } catch (error: any) {
      clearTimeout(timeoutId);

      // Handle timeout
      if (error.name === "AbortError" || signal.aborted) {
        return {
          value: null,
          diagnostics: [{
            code: "timeout",
            message: `Validation timed out after ${timeoutMs}ms`,
            severity: "error"
          }],
          perf: { durationMs: Date.now() - started }
        };
      }

      // Handle validation errors
      return {
        value: null,
        diagnostics: [{
          code: "validation_error",
          message: error instanceof Error ? error.message : String(error),
          severity: "error"
        }],
        perf: { durationMs: Date.now() - started }
      };
    }

  } catch (error: any) {
    // Handle schema/parsing errors
    return {
      value: null,
      diagnostics: [{
        code: "schema_error",
        message: error instanceof Error ? error.message : String(error),
        severity: "error"
      }],
      perf: { durationMs: Date.now() - started }
    };
  }
}

/**
 * Count diagnostics by severity
 */
function countDiagnostics(diagnostics: DiagnosticT[]): Record<string, number> {
  const counts: Record<string, number> = { error: 0, warning: 0, info: 0 };
  for (const diag of diagnostics) {
    const severity = diag.severity ?? "info";
    counts[severity] = (counts[severity] ?? 0) + 1;
  }
  return counts;
}

/**
 * Audit log (stdout for now, can be replaced with proper sink)
 */
function logAudit(entry: {
  reqId: string;
  orgId: string;
  userId?: string;
  tool: string;
  capsEffective: string[];
  durationMs: number;
  diagCounts: Record<string, number>;
}) {
  const log = {
    ts: new Date().toISOString(),
    ...entry
  };
  console.error(`[AUDIT] ${JSON.stringify(log)}`);
}
