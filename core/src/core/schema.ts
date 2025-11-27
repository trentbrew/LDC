import { z } from "zod";

/**
 * Authentication context for requests
 */
export const Auth = z.object({
  orgId: z.string(),
  userId: z.string().optional(),
  keyId: z.string().optional()
});

/**
 * Capability map for capability-based security (default-deny)
 */
export const Caps = z.record(z.array(z.string()));

/**
 * Evaluation options
 */
export const EvalOptions = z.object({
  now: z.string().datetime().optional(),
  asOf: z.string().optional(),
  caps: Caps.optional(),
  timeoutMs: z.number().int().positive().max(5_000).optional(),
  runtimeVersion: z.string().optional()
});

/**
 * Input for evaluation requests
 */
export const EvalInput = z.object({
  doc: z.record(z.any()),
  options: EvalOptions.optional(),
  auth: Auth
});

/**
 * Diagnostic information for validation/evaluation
 */
export const Diagnostic = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
  severity: z.enum(["error", "warning", "info"]).optional()
});

/**
 * Output from evaluation/validation
 */
export const EvalOutput = z.object({
  value: z.any(),
  diagnostics: z.array(Diagnostic),
  prov: z.record(z.any()).optional(),
  perf: z.object({ durationMs: z.number() }).optional(),
  sig: z.string().optional()
});

// Type exports
export type AuthT = z.infer<typeof Auth>;
export type CapsT = z.infer<typeof Caps>;
export type EvalOptionsT = z.infer<typeof EvalOptions>;
export type EvalInputT = z.infer<typeof EvalInput>;
export type DiagnosticT = z.infer<typeof Diagnostic>;
export type EvalOutputT = z.infer<typeof EvalOutput>;
