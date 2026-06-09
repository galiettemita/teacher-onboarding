/**
 * In-memory fixed-window rate limiter.
 *
 * MVP rationale (see docs/SECURITY.md §3): the portal runs as a single
 * Next.js process per deploy. A token bucket / sliding window with one
 * Map is sufficient for our traffic profile (≲100 teachers, one secretary).
 * Cross-instance limits will need Redis / Upstash when we horizontally
 * scale — explicitly out of scope for MVP.
 *
 * Counters are bucketed by a string key + a fixed-size window. When the
 * window rolls over the count resets to 1. A separate sweeper drops
 * stale buckets to bound memory.
 */
export interface RateLimitRule {
  /** Human label for diagnostics (e.g. "auth"). */
  name: string;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Maximum hits per window. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (only meaningful when !allowed). */
  retryAfterSeconds: number;
  /** Remaining hits in this window (0 when blocked). */
  remaining: number;
  /** Bucket reset epoch ms — useful for X-RateLimit-Reset. */
  resetAt: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

/**
 * Check the limit for a composite key and consume one token if allowed.
 *
 * Keys are namespaced: callers always pass `${rule.name}:${subject}`.
 * `subject` is typically `ip:<address>` or `user:<userId>`.
 */
export function check(rule: RateLimitRule, subject: string, now = Date.now()): RateLimitResult {
  const key = `${rule.name}:${subject}`;
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + rule.windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, retryAfterSeconds: 0, remaining: rule.max - 1, resetAt };
  }

  if (existing.count >= rule.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: rule.max - existing.count,
    resetAt: existing.resetAt,
  };
}

/** Wipe every bucket. Tests only. */
export function _resetForTests(): void {
  store.clear();
}

/** Drop expired buckets. Call from a periodic sweep if memory matters. */
export function sweep(now = Date.now()): number {
  let dropped = 0;
  for (const [k, v] of store) {
    if (v.resetAt <= now) {
      store.delete(k);
      dropped += 1;
    }
  }
  return dropped;
}
