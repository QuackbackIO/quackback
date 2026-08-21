/**
 * Per-user device-fingerprint tracker. The set `user:devices:{userId}` holds the
 * recent (UA + /24 IP) hashes seen for the user; new-device notifications fire
 * only on first-sight.
 *
 * Two-phase API so notification failures don't silently lose the
 * alert: `isDeviceUnseen` atomically claims the fingerprint in one
 * statement; the caller follows with `markDeviceSeen` on success or
 * `forgetDevice` on failure. Errors fail closed (treat as known
 * device) so a store outage suppresses notifications rather than
 * spamming users.
 */
import { createHash } from 'node:crypto'
import { kvSetMemberClaim, kvSetTouch, kvSetMemberRemove } from '@/lib/server/kv/pg-kv'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'signin-device-tracker' })

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

// User ids are only unique within a workspace database, so an undiscriminated
// set would let one workspace's sign-in suppress another's new-device alert — the
// notification whose entire job is to be the first sign of a stolen credential.
// `pg-kv.ts` writes the workspace into the row's key; under pooled tenancy the row
// is additionally in that workspace's own database.
const key = (userId: string) => `user:devices:${userId}`

/**
 * Atomic claim: returns true iff this is the first sighting. One statement, so
 * the claim and the expiry cannot separate — even if the caller crashes before
 * `markDeviceSeen` runs, the member still expires after 90 days.
 */
export async function isDeviceUnseen(userId: string, fingerprint: string): Promise<boolean> {
  try {
    return await kvSetMemberClaim(key(userId), fingerprint, DEVICE_SET_TTL_SECONDS)
  } catch (error) {
    log.error({ err: error }, 'isDeviceUnseen failed; treating device as known')
    return false
  }
}

/** Slide the 90-day window forward after a successful notification. */
export async function markDeviceSeen(userId: string): Promise<void> {
  try {
    await kvSetTouch(key(userId), DEVICE_SET_TTL_SECONDS)
  } catch (error) {
    log.error({ err: error }, 'markDeviceSeen failed')
  }
}

/** Roll back a claim so the next sign-in re-fires the notification. */
export async function forgetDevice(userId: string, fingerprint: string): Promise<void> {
  try {
    await kvSetMemberRemove(key(userId), fingerprint)
  } catch (error) {
    log.error({ err: error }, 'forgetDevice failed')
  }
}
