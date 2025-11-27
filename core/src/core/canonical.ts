/**
 * Canonical JSON serialization for deterministic signatures
 * 
 * Rules:
 * - Stable key order (alphabetical)
 * - UTF-8 encoding
 * - No whitespace
 * - Floats as decimal strings (no scientific notation)
 * - Dates as ISO 8601 UTC
 * - null, boolean, string, number, array, object only
 */

/**
 * Canonicalize a value for deterministic signing
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(value, canonicalReplacer, 0);
}

/**
 * JSON replacer that ensures deterministic output
 */
function canonicalReplacer(_key: string, value: unknown): unknown {
  // Handle null
  if (value === null) {
    return null;
  }

  // Handle Date → ISO UTC string
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Handle numbers → decimal string for floats
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      // Keep integers as-is, convert floats to fixed decimal
      if (Number.isInteger(value)) {
        return value;
      }
      // Use toPrecision to avoid scientific notation
      return parseFloat(value.toPrecision(15));
    }
    // NaN, Infinity → null
    return null;
  }

  // Handle objects → sort keys
  if (typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = (value as Record<string, unknown>)[key];
    }
    return sorted;
  }

  // Primitives and arrays pass through
  return value;
}

/**
 * Create a signable payload by excluding non-deterministic fields
 */
export function createSignablePayload(data: {
  doc: Record<string, unknown>;
  options?: Record<string, unknown>;
  value: unknown;
  prov?: Record<string, unknown>;
  runtimeVersion?: string;
}): Record<string, unknown> {
  const { doc, options, value, prov, runtimeVersion } = data;

  // Build canonical payload (exclude perf, timestamps, etc.)
  const payload: Record<string, unknown> = {
    doc,
    value,
  };

  // Add options if present (normalized)
  if (options) {
    const { caps, timeoutMs, runtimeVersion: rv, ...rest } = options as any;
    const normalized: Record<string, unknown> = {};
    
    // Include caps if present
    if (caps) {
      normalized.caps = caps;
    }
    
    // Include runtime version
    if (rv || runtimeVersion) {
      normalized.runtimeVersion = rv || runtimeVersion;
    }
    
    // Include other options (excluding timeout which is non-deterministic)
    Object.assign(normalized, rest);
    
    if (Object.keys(normalized).length > 0) {
      payload.options = normalized;
    }
  }

  // Add provenance if present
  if (prov) {
    payload.prov = prov;
  }

  // Add runtime version at top level if specified
  if (runtimeVersion) {
    payload.runtimeVersion = runtimeVersion;
  }

  return payload;
}
