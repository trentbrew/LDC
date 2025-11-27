/**
 * Centralized capability-based policy enforcement
 * 
 * Default-deny: no capabilities granted unless explicitly allowed
 * Org policies loaded from database/environment
 */

import type { CapsT } from "./schema.js";

export interface Enforcement {
  allowed: CapsT;
  denied: CapsT;
  audit: string[];
}

/**
 * Load org policy from database/environment
 * TODO: Replace with real database lookup
 */
function loadOrgPolicy(orgId: string): CapsT {
  // Development: allow some caps for testing
  if (process.env.NODE_ENV !== "production") {
    // Example: allow network access to specific domains
    return {
      network: ["https://api.example.com"],
      // file: ["read:/tmp"],
    };
  }

  // Production: load from database
  // const policy = await db.getOrgPolicy(orgId);
  // return policy.allowedCaps;

  // Default: no capabilities
  void orgId;
  return {};
}

/**
 * Create audit log lines for capability enforcement
 */
function mkAuditLines(allowed: CapsT, denied: CapsT): string[] {
  const lines: string[] = [];

  for (const [cap, values] of Object.entries(allowed)) {
    lines.push(`cap_allowed: ${cap}=[${values.join(", ")}]`);
  }

  for (const [cap, values] of Object.entries(denied)) {
    lines.push(`cap_denied: ${cap}=[${values.join(", ")}]`);
  }

  return lines;
}

/**
 * Enforce capability-based security
 * 
 * Returns:
 *   - allowed: capabilities that are granted
 *   - denied: capabilities that were requested but denied
 *   - audit: log lines for audit trail
 */
export function enforceCaps(orgId: string, requested: CapsT): Enforcement {
  const policy = loadOrgPolicy(orgId);
  const allowed: CapsT = {};
  const denied: CapsT = {};

  for (const [cap, requestedValues] of Object.entries(requested ?? {})) {
    const policyValues = policy[cap] ?? [];
    
    // Filter: only allow values that are in the policy
    const allowedValues = requestedValues.filter((v) =>
      policyValues.includes(v)
    );
    const deniedValues = requestedValues.filter(
      (v) => !policyValues.includes(v)
    );

    if (allowedValues.length > 0) {
      allowed[cap] = allowedValues;
    }
    if (deniedValues.length > 0) {
      denied[cap] = deniedValues;
    }
  }

  const audit = mkAuditLines(allowed, denied);

  return { allowed, denied, audit };
}

/**
 * Format denied capabilities as diagnostic-friendly string
 */
export function formatDeniedCaps(denied: CapsT): string {
  const parts: string[] = [];
  for (const [cap, values] of Object.entries(denied)) {
    parts.push(`${cap}=[${values.join(", ")}]`);
  }
  return parts.join("; ");
}
