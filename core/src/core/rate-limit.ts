/**
 * Rate limiting with token bucket + sliding window
 * 
 * Per-org token bucket for burst protection
 * Per-IP sliding window for DoS protection
 * 
 * TODO: Add Redis backend for distributed rate limiting
 */

interface TokenBucket {
  tokens: number;
  updated: number;
}

interface SlidingWindow {
  requests: number[];
  windowMs: number;
}

// In-memory storage (replace with Redis for production)
const orgBuckets = new Map<string, TokenBucket>();
const ipWindows = new Map<string, SlidingWindow>();

/**
 * Token bucket rate limiter (per org)
 * 
 * @param orgId - Organization ID
 * @param rate - Tokens per second (default: 5)
 * @param burst - Maximum burst size (default: 10)
 * @returns true if request is allowed, false if rate limited
 */
export function takeOrgToken(
  orgId: string,
  rate: number = 5,
  burst: number = 10
): boolean {
  const now = Date.now();
  const bucket = orgBuckets.get(orgId) ?? { tokens: burst, updated: now };

  // Refill tokens based on elapsed time
  const elapsed = (now - bucket.updated) / 1000; // seconds
  const refill = elapsed * rate;
  bucket.tokens = Math.min(burst, bucket.tokens + refill);
  bucket.updated = now;

  // Check if we have tokens available
  if (bucket.tokens < 1) {
    orgBuckets.set(orgId, bucket);
    return false;
  }

  // Consume one token
  bucket.tokens -= 1;
  orgBuckets.set(orgId, bucket);
  return true;
}

/**
 * Sliding window rate limiter (per IP)
 * 
 * @param ip - Client IP address
 * @param limit - Maximum requests per window (default: 100)
 * @param windowMs - Window size in milliseconds (default: 60000 = 1 minute)
 * @returns true if request is allowed, false if rate limited
 */
export function checkIpWindow(
  ip: string,
  limit: number = 100,
  windowMs: number = 60_000
): boolean {
  const now = Date.now();
  const window = ipWindows.get(ip) ?? { requests: [], windowMs };

  // Remove requests outside the window
  window.requests = window.requests.filter((ts) => now - ts < windowMs);

  // Check if we're over the limit
  if (window.requests.length >= limit) {
    ipWindows.set(ip, window);
    return false;
  }

  // Add this request to the window
  window.requests.push(now);
  ipWindows.set(ip, window);
  return true;
}

/**
 * Combined rate limit check (org + IP)
 */
export function checkRateLimit(
  orgId: string,
  ip: string
): { allowed: boolean; reason?: string } {
  // Check org token bucket
  if (!takeOrgToken(orgId)) {
    return { allowed: false, reason: "org_rate_limit" };
  }

  // Check IP sliding window
  if (!checkIpWindow(ip)) {
    return { allowed: false, reason: "ip_rate_limit" };
  }

  return { allowed: true };
}

/**
 * Get rate limit stats for an org
 */
export function getOrgStats(orgId: string): {
  tokensAvailable: number;
  lastUpdate: number;
} {
  const bucket = orgBuckets.get(orgId);
  if (!bucket) {
    return { tokensAvailable: 10, lastUpdate: Date.now() };
  }

  return {
    tokensAvailable: Math.floor(bucket.tokens),
    lastUpdate: bucket.updated,
  };
}

/**
 * Get rate limit stats for an IP
 */
export function getIpStats(ip: string): {
  requestsInWindow: number;
  windowMs: number;
} {
  const window = ipWindows.get(ip);
  if (!window) {
    return { requestsInWindow: 0, windowMs: 60_000 };
  }

  const now = Date.now();
  const activeRequests = window.requests.filter(
    (ts) => now - ts < window.windowMs
  );

  return {
    requestsInWindow: activeRequests.length,
    windowMs: window.windowMs,
  };
}

/**
 * Clear rate limit data (for testing)
 */
export function clearRateLimits() {
  orgBuckets.clear();
  ipWindows.clear();
}

/**
 * Cleanup old entries (run periodically)
 */
export function cleanupRateLimits() {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes

  // Cleanup org buckets
  for (const [orgId, bucket] of orgBuckets.entries()) {
    if (now - bucket.updated > maxAge) {
      orgBuckets.delete(orgId);
    }
  }

  // Cleanup IP windows
  for (const [ip, window] of ipWindows.entries()) {
    window.requests = window.requests.filter((ts) => now - ts < window.windowMs);
    if (window.requests.length === 0) {
      ipWindows.delete(ip);
    }
  }
}

// Cleanup every 5 minutes
setInterval(cleanupRateLimits, 5 * 60 * 1000);
