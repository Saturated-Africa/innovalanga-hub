/**
 * In-memory rate limiting.
 *
 * The platform runs as a single container on one instance, so a shared store is
 * not needed and would be the more fragile choice: a Redis dependency that can
 * fail open is worse than a counter that cannot. If the deployment ever grows to
 * more than one app instance, this must move to a shared store, and the note
 * below the constants says so.
 *
 * There was previously no rate limiting anywhere in the application. Login,
 * registration and the calendar token check all accepted unlimited attempts.
 *
 * Two dimensions are tracked independently for sign-in, because they defend
 * different attacks: per-IP catches one host spraying many accounts, per-account
 * catches a distributed attempt against one account.
 */

interface Bucket {
  count: number
  /** Epoch ms when this bucket resets. */
  resetAt: number
  /** Epoch ms until which this key is locked out, if it tripped the limit. */
  lockedUntil?: number
}

const buckets = new Map<string, Bucket>()

/** Cap on distinct keys, so a spray of unique IPs cannot grow this unbounded. */
const MAX_KEYS = 20_000

export interface RateLimitRule {
  /** Attempts permitted inside the window. */
  limit: number
  /** Window length in ms. */
  windowMs: number
  /** How long a key is refused after exceeding the limit. */
  lockoutMs: number
}

export const LOGIN_PER_ACCOUNT: RateLimitRule = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}

export const LOGIN_PER_IP: RateLimitRule = {
  limit: 20,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}

export const REGISTER_PER_IP: RateLimitRule = {
  limit: 5,
  windowMs: 60 * 60 * 1000,
  lockoutMs: 60 * 60 * 1000,
}

export const TOKEN_PER_IP: RateLimitRule = {
  limit: 30,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the caller may retry. Only meaningful when blocked. */
  retryAfterSeconds: number
  remaining: number
}

/** Drop expired entries. Called opportunistically, not on a timer. */
function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    const expired = bucket.resetAt < now && (bucket.lockedUntil ?? 0) < now
    if (expired) buckets.delete(key)
  }
}

/**
 * Record an attempt against `key` and report whether it is permitted.
 *
 * Call this on the attempt, not on the failure, so that a flood of requests is
 * limited even when each one is malformed.
 */
export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now()

  if (buckets.size > MAX_KEYS) sweep(now)

  const existing = buckets.get(key)

  if (existing?.lockedUntil && existing.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.lockedUntil - now) / 1000),
      remaining: 0,
    }
  }

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs })
    return { allowed: true, retryAfterSeconds: 0, remaining: rule.limit - 1 }
  }

  existing.count += 1

  if (existing.count > rule.limit) {
    existing.lockedUntil = now + rule.lockoutMs
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(rule.lockoutMs / 1000),
      remaining: 0,
    }
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: rule.limit - existing.count,
  }
}

/** Clear a key after a genuine success, so one bad day does not compound. */
export function clearRateLimit(key: string) {
  buckets.delete(key)
}

/**
 * Best-effort client address.
 *
 * Caddy sits in front and sets X-Forwarded-For. The left-most entry is the
 * client as Caddy saw it. This is only as trustworthy as the proxy in front,
 * which is why the per-account limit exists alongside it.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Only for tests. */
export function resetAllRateLimits() {
  buckets.clear()
}
