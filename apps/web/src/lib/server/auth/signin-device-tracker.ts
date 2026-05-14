/**
 * Per-user device-fingerprint tracker. Redis SET
 * `user:devices:{userId}` holds the recent (UA + /24 IP) hashes seen
 * for the user; new-device notifications fire only on first-sight.
 *
 * Two-phase API so notification failures don't silently lose the
 * alert: `isDeviceUnseen` atomically claims the fingerprint via SADD;
 * the caller follows with `markDeviceSeen` on success or
 * `forgetDevice` on failure. Errors fail closed (treat as known
 * device) so a Redis outage suppresses notifications rather than
 * spamming users.
 */
import { createHash } from 'node:crypto'
import { getRedis } from '@/lib/server/redis'

const DEVICE_SET_TTL_SECONDS = 90 * 24 * 60 * 60

/**
 * SHA-256 of (UA + /24 IPv4 subnet) truncated to 128 bits / 32 hex
 * chars. /24 keeps dynamic-IP users on the same network from tripping
 * on every connection; IPv6 is hashed whole (most carriers hand out
 * stable /64s, but we don't bias on carrier data here).
 */
export function computeDeviceFingerprint(userAgent: string, ip: string): string {
  const normalisedIp = ip.includes(':') ? ip : ip.split('.').slice(0, 3).join('.')
  return createHash('sha256').update(`${userAgent}|${normalisedIp}`).digest('hex').slice(0, 32)
}

const key = (userId: string) => `user:devices:${userId}`

/**
 * Atomic claim: returns true iff this is the first sighting (SADD
 * reply = 1). SADD + EXPIRE NX run in one pipeline so the TTL is
 * always set on first claim — even if the caller crashes before
 * `markDeviceSeen` runs, the SET still expires after 90 days.
 */
export async function isDeviceUnseen(userId: string, fingerprint: string): Promise<boolean> {
  try {
    const pipeline = getRedis().multi()
    pipeline.sadd(key(userId), fingerprint)
    pipeline.expire(key(userId), DEVICE_SET_TTL_SECONDS, 'NX')
    const results = await pipeline.exec()
    return Number(results?.[0]?.[1] ?? 0) === 1
  } catch (error) {
    console.error('[signin-device-tracker] isDeviceUnseen failed; treating as known:', error)
    return false
  }
}

/** Slide the 90-day window forward after a successful notification. */
export async function markDeviceSeen(userId: string): Promise<void> {
  try {
    await getRedis().expire(key(userId), DEVICE_SET_TTL_SECONDS)
  } catch (error) {
    console.error('[signin-device-tracker] markDeviceSeen failed:', error)
  }
}

/** Roll back a claim so the next sign-in re-fires the notification. */
export async function forgetDevice(userId: string, fingerprint: string): Promise<void> {
  try {
    await getRedis().srem(key(userId), fingerprint)
  } catch (error) {
    console.error('[signin-device-tracker] forgetDevice failed:', error)
  }
}
