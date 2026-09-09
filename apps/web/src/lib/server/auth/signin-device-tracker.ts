/**
 * Per-user device-fingerprint tracker. The set `user:devices:v2:{userId}`
 * holds the recent (browser + OS + platform) hashes seen for the user.
 * `v2` is a new key so leftover UA+/24 hashes from the previous format
 * cannot make the first normalised browser look like an additional device.
 *
 * Identity is the normalised user-agent, not the IP. IP belongs in the
 * new-sign-in email as forensic context; hashing it in treats 5G / CGNAT /
 * VPN / travel as a new device.
 *
 * Two-phase API so notification failures don't silently lose the
 * alert: `isDeviceUnseen` atomically claims the fingerprint in one
 * statement; the caller follows with `markDeviceSeen` on success or
 * `forgetDevice` on failure. Errors fail closed (treat as known
 * device) so a store outage suppresses notifications rather than
 * spamming users.
 *
 * The first live member in a user's set is seeded silently — that is
 * the sign-in they just made. Mail fires only on an additional unseen
 * browser/OS.
 */
import { createHash } from 'node:crypto'
import Bowser from 'bowser'
import { kvSetMemberClaimCounted, kvSetTouch, kvSetMemberRemove } from '@/lib/server/kv/pg-kv'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'signin-device-tracker' })

const DEVICE_SET_TTL_SECONDS = 90 * 24 * 60 * 60

/** Stable hash input when the UA is empty or unparseable. */
const UNKNOWN_DEVICE_KEY = 'unknown||'

/**
 * Browser + OS + platform, with versions stripped so an auto-update does
 * not look like a new device. Empty / unparseable UAs share one sentinel
 * rather than hashing each garbage string.
 */
export function signInDeviceKey(userAgent: string): string {
  const trimmed = userAgent.trim()
  if (!trimmed) return UNKNOWN_DEVICE_KEY
  try {
    const parser = Bowser.getParser(trimmed)
    const browser = parser.getBrowserName() || ''
    const os = parser.getOSName() || ''
    const platform = parser.getPlatformType() || ''
    if (!browser && !os && !platform) return UNKNOWN_DEVICE_KEY
    return `${browser}|${os}|${platform}`
  } catch {
    return UNKNOWN_DEVICE_KEY
  }
}

/** Human-readable line for the new-sign-in email, e.g. `Chrome on Windows`. */
export function formatSignInDevice(userAgent: string): string {
  const key = signInDeviceKey(userAgent)
  if (key === UNKNOWN_DEVICE_KEY) return 'Unknown device'
  const [browser, os] = key.split('|')
  if (browser && os) return `${browser} on ${os}`
  return browser || os || 'Unknown device'
}

/**
 * SHA-256 of the normalised device key, truncated to 128 bits / 32 hex
 * chars. IP is deliberately not part of the hash.
 */
export function computeDeviceFingerprint(userAgent: string): string {
  return createHash('sha256').update(signInDeviceKey(userAgent)).digest('hex').slice(0, 32)
}

// User ids are only unique within a workspace database, so an undiscriminated
// set would let one workspace's sign-in suppress another's new-device alert — the
// notification whose entire job is to be the first sign of a stolen credential.
// `pg-kv.ts` writes the workspace into the row's key; under pooled tenancy the row
// is additionally in that workspace's own database.
const key = (userId: string) => `user:devices:v2:${userId}`

/**
 * Atomic claim. Returns true iff this is an *additional* unseen device
 * (the set already had at least one live member). The first recorded
 * device is claimed and given the 90-day TTL but does not notify — that
 * is the user's own sign-in, and it also absorbs a hash-format change
 * without a one-time mail burst.
 *
 * Known devices slide the set's 90-day window here. Otherwise a daily
 * sign-in never calls `markDeviceSeen`, the member expires, and the next
 * distinct browser is treated as a silent first seed.
 */
export async function isDeviceUnseen(userId: string, fingerprint: string): Promise<boolean> {
  try {
    const { claimed, liveCount } = await kvSetMemberClaimCounted(
      key(userId),
      fingerprint,
      DEVICE_SET_TTL_SECONDS
    )
    if (!claimed) {
      await kvSetTouch(key(userId), DEVICE_SET_TTL_SECONDS)
      return false
    }
    return liveCount > 1
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
