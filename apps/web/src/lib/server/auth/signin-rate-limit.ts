/**
 * Per-endpoint rate-limiters for sign-in. Built on `redis-rate-bucket`
 * so they share INCR/EXPIRE-NX/TTL plumbing with `recovery-codes-consume`
 * and any future limiters.
 *
 * Two shapes:
 *  - Credential: 5/5min per (ip+email) + 50/15min per IP. Brute-force
 *    defence + email-rotation defence. Both success and failure count.
 *  - Magic-link send: 3/15min per (ip+email) + 20/15min per IP. Looser
 *    cap aimed at email-spam, not credential guessing.
 *
 * Fail open on Redis errors.
 */
import {
  bucketRetryAfter,
  incrementBuckets,
  type RateBucketSpec,
} from '@/lib/server/utils/redis-rate-bucket'

export interface SignInRateLimitResult {
  allowed: boolean
  retryAfter?: number
}

export type SignInRateLimiter = (ip: string, email: string) => Promise<SignInRateLimitResult>

interface LimiterShape {
  tupleLimit: number
  tupleWindowS: number
  ipLimit: number
  ipWindowS: number
  tupleKey: (ip: string, email: string) => string
  ipKey: (ip: string) => string
}

const CREDENTIAL: LimiterShape = {
  tupleLimit: 5,
  tupleWindowS: 5 * 60,
  ipLimit: 50,
  ipWindowS: 15 * 60,
  tupleKey: (ip, email) => `signin:credential:${ip}:${email}`,
  ipKey: (ip) => `signin:credential:ip:${ip}`,
}

const MAGIC_LINK: LimiterShape = {
  tupleLimit: 3,
  tupleWindowS: 15 * 60,
  ipLimit: 20,
  ipWindowS: 15 * 60,
  tupleKey: (ip, email) => `signin:magiclink:${ip}:${email}`,
  ipKey: (ip) => `signin:magiclink:ip:${ip}`,
}

async function check(
  shape: LimiterShape,
  ip: string,
  email: string
): Promise<SignInRateLimitResult> {
  const tupleSpec: RateBucketSpec = {
    key: shape.tupleKey(ip, email),
    windowSeconds: shape.tupleWindowS,
  }
  const ipSpec: RateBucketSpec = {
    key: shape.ipKey(ip),
    windowSeconds: shape.ipWindowS,
  }
  const [tupleCount, ipCount] = await incrementBuckets([tupleSpec, ipSpec])
  // Either Redis error → fail open.
  if (tupleCount === null || ipCount === null) return { allowed: true }
  if (tupleCount > shape.tupleLimit) {
    return { allowed: false, retryAfter: await bucketRetryAfter(tupleSpec) }
  }
  if (ipCount > shape.ipLimit) {
    return { allowed: false, retryAfter: await bucketRetryAfter(ipSpec) }
  }
  return { allowed: true }
}

export const checkCredentialSignInRateLimit: SignInRateLimiter = (ip, email) =>
  check(CREDENTIAL, ip, email)

export const checkMagicLinkSendRateLimit: SignInRateLimiter = (ip, email) =>
  check(MAGIC_LINK, ip, email)
