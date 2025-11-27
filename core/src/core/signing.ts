/**
 * HMAC-SHA256 signing for deterministic evaluation results
 * 
 * Header contract:
 *   X-LDC-Signature: v=1; alg=hmac-sha256; key=kid_2025_10; sig=BASE64URL(...)
 *   X-LDC-Timestamp: 173...   // unix ms
 * 
 * What we sign (already canonicalized):
 *   canonicalize({ doc, options: optionsEff, value, prov, runtimeVersion, ts })
 */

import { createHmac, timingSafeEqual } from "crypto";

/**
 * Base64 URL-safe encoding (RFC 4648)
 */
export function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Base64 URL-safe decoding
 */
export function base64urlDecode(str: string): Buffer {
  // Add padding back
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  // Replace URL-safe chars
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64");
}

/**
 * Sign a payload with HMAC-SHA256
 */
export function signHmac256(secret: string, payload: string): string {
  const hmac = createHmac("sha256", Buffer.from(secret, "utf8"));
  hmac.update(payload, "utf8");
  return base64url(hmac.digest());
}

/**
 * Verify an HMAC-SHA256 signature (timing-safe)
 */
export function verifyHmac256(
  secret: string,
  payload: string,
  sigB64u: string
): boolean {
  try {
    const expected = signHmac256(secret, payload);
    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(sigB64u, "utf8");

    // Timing-safe comparison
    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

/**
 * Parse signature header
 * Format: v=1; alg=hmac-sha256; key=kid_2025_10; sig=BASE64URL(...)
 */
export function parseSignatureHeader(header: string): {
  version: string;
  algorithm: string;
  keyId: string;
  signature: string;
} | null {
  try {
    const parts = header.split(";").map((p) => p.trim());
    const parsed: Record<string, string> = {};

    for (const part of parts) {
      const [key, value] = part.split("=").map((s) => s.trim());
      parsed[key] = value;
    }

    if (!parsed.v || !parsed.alg || !parsed.key || !parsed.sig) {
      return null;
    }

    return {
      version: parsed.v,
      algorithm: parsed.alg,
      keyId: parsed.key,
      signature: parsed.sig,
    };
  } catch {
    return null;
  }
}

/**
 * Format signature header
 */
export function formatSignatureHeader(
  signature: string,
  keyId: string = "default",
  algorithm: string = "hmac-sha256"
): string {
  return `v=1; alg=${algorithm}; key=${keyId}; sig=${signature}`;
}

/**
 * Validate timestamp (reject if > 5 minutes old)
 */
export function validateTimestamp(
  timestampMs: number,
  maxAgeMs: number = 5 * 60 * 1000
): boolean {
  const now = Date.now();
  const age = Math.abs(now - timestampMs);
  return age <= maxAgeMs;
}

/**
 * Get signing secret from environment
 */
export function getSigningSecret(): string {
  const secret = process.env.LDC_SIGNING_SECRET;
  if (!secret) {
    // Development fallback (NOT for production)
    if (process.env.NODE_ENV === "production") {
      throw new Error("LDC_SIGNING_SECRET must be set in production");
    }
    return "dev-secret-change-in-production";
  }
  return secret;
}

/**
 * Get key ID from environment
 */
export function getKeyId(): string {
  return process.env.LDC_KEY_ID ?? "kid_2025_10";
}
