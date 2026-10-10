/**
 * Per-user known-device tracker. The set `user:devices:v3:{userId}`
 * holds the signed cookie ids seen for the user. `v3` is a new key so
 * leftover UA / browser-family hashes cannot make the first cookie id
 * look like an additional device.
 *
 * Identity is the cookie, not the user-agent and not the IP. Bowser is
 * the email's display line only (`formatSignInDevice`). IP belongs in
 * the new-sign-in email as forensic context.
 *
 * `isDeviceUnseen` atomically claims the id. The claim already writes
 * the 90-day TTL. On notification failure the caller `forgetDevice`s
 * so the next sign-in re-fires. Errors fail closed (treat as known)
 * so a store outage suppresses mail rather than spamming users.
 *
 * The first live member in a user's set is seeded silently — that is
 * the sign-in they just made. Mail fires only on an additional unseen
 * cookie. Known devices slide only that member's 90-day window, so an
 * unused browser's id can expire on its own.
 */
import Bowser from 'bowser'
import { kvSetMemberClaimCounted, kvSetMemberRemove, kvSetMemberTouch } from '@/lib/server/kv/pg-kv'
import { logger } from '@/lib/server/logger'
import { DEVICE_TTL_SECONDS } from './signin-device-cookie'

const log = logger.child({ component: 'signin-device-tracker' })

/** Display sentinel when the UA is empty or unparseable. */
const UNKNOWN_DEVICE_KEY = 'unknown||'

/** Browser + OS + platform for the email line. Versions stripped so an
 *  auto-update does not change `Chrome on Windows`. */
function signInDeviceKey(userAgent: string): string {
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

// User ids are only unique within a workspace database, so an undiscriminated
// set would let one workspace's sign-in suppress another's new-device alert — the
// notification whose entire job is to be the first sign of a stolen credential.
// `pg-kv.ts` writes the workspace into the row's key; under pooled tenancy the row
// is additionally in that workspace's own database.
const key = (userId: string) => `user:devices:v3:${userId}`

/**
 * Atomic claim. Returns true iff this is an *additional* unseen device
 * (the set already had at least one live member). The first recorded
 * device is claimed and given the 90-day TTL but does not notify — that
 * is the user's own sign-in, and it also absorbs a key-format change
 * without a one-time mail burst.
 *
 * Known devices slide only this member's 90-day window. A whole-set
 * touch would keep unused cookie ids alive for as long as any one
 * browser signs in.
 */
export async function isDeviceUnseen(userId: string, deviceId: string): Promise<boolean> {
  try {
    const { claimed, liveCount } = await kvSetMemberClaimCounted(
      key(userId),
      deviceId,
      DEVICE_TTL_SECONDS
    )
    if (!claimed) {
      await kvSetMemberTouch(key(userId), deviceId, DEVICE_TTL_SECONDS)
      return false
    }
    return liveCount > 1
  } catch (error) {
    log.error({ err: error }, 'isDeviceUnseen failed; treating device as known')
    return false
  }
}

/** Roll back a claim so the next sign-in re-fires the notification. */
export async function forgetDevice(userId: string, deviceId: string): Promise<void> {
  try {
    await kvSetMemberRemove(key(userId), deviceId)
  } catch (error) {
    log.error({ err: error }, 'forgetDevice failed')
  }
}
