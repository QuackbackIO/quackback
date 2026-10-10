/**
 * Signed known-device cookie.
 *
 * The cookie is the identity for new-sign-in mail. Bowser stays on the
 * email as the display line (`Chrome on Windows`); it is not the claim
 * key. A random 128-bit id is HMAC-SHA256'd with the workspace secret
 * so another account on the same browser cannot reuse it, and so a
 * forged cookie is rejected.
 *
 * Per-user cookie name (`qb.device.{userId}`) so two accounts on one
 * browser keep separate ids — overwriting a single shared cookie would
 * make the other person look new on the next sign-in.
 *
 * Host-only (no `Domain`): pooled custom hosts must not leak the cookie
 * across sibling sites on a parent domain.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { activeSecretKey } from '@/lib/server/secret-key'

const DEVICE_COOKIE_PREFIX = 'qb.device.'
export const DEVICE_TTL_SECONDS = 90 * 24 * 60 * 60

const DOMAIN_TAG = 'qb.device:v1\n'
const DEVICE_ID_RE = /^[0-9a-f]{32}$/
/** Cookie-name token: TypeIDs and the dotted prefix both match. */
const COOKIE_TOKEN_RE = /^[A-Za-z0-9_.-]+$/

export function deviceCookieName(userId: string): string {
  if (!COOKIE_TOKEN_RE.test(userId)) {
    throw new Error('device cookie: userId is not a valid cookie-name token')
  }
  return `${DEVICE_COOKIE_PREFIX}${userId}`
}

export function mintDeviceId(): string {
  return randomBytes(16).toString('hex')
}

function macFor(userId: string, deviceId: string): string {
  return createHmac('sha256', activeSecretKey())
    .update(DOMAIN_TAG)
    .update(`${userId}.${deviceId}`)
    .digest('base64url')
}

/** `v1.{32-hex-id}.{hmac}` — all cookie-safe, no encoding needed. */
export function signDeviceCookie(userId: string, deviceId: string): string {
  if (!DEVICE_ID_RE.test(deviceId)) {
    throw new Error('device cookie: deviceId must be 32 hex chars')
  }
  return `v1.${deviceId}.${macFor(userId, deviceId)}`
}

export function verifyDeviceCookie(userId: string, value: string): string | null {
  const match = /^v1\.([0-9a-f]{32})\.([A-Za-z0-9_-]+)$/.exec(value)
  if (!match) return null
  const deviceId = match[1]
  const provided = match[2]
  const expected = macFor(userId, deviceId)
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return deviceId
}

/** First matching `name=` pair; later duplicates do not override. */
export function namedCookie(cookieHeader: string, name: string): string | null {
  if (!cookieHeader || !COOKIE_TOKEN_RE.test(name)) return null
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    if (trimmed.slice(0, eq) !== name) continue
    return trimmed.slice(eq + 1)
  }
  return null
}

export function readDeviceCookie(cookieHeader: string, userId: string): string | null {
  const value = namedCookie(cookieHeader, deviceCookieName(userId))
  if (!value) return null
  return verifyDeviceCookie(userId, value)
}

export function deviceCookieAttributes(secure: boolean): {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: '/'
  maxAge: number
} {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_TTL_SECONDS,
  }
}
