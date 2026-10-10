/**
 * Signed known-device cookie: HMAC-bound to userId, host-only attributes,
 * per-user cookie name so two accounts on one browser do not overwrite.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'unit-test-device-cookie-secret',
}))

const {
  DEVICE_TTL_SECONDS,
  deviceCookieAttributes,
  deviceCookieName,
  mintDeviceId,
  namedCookie,
  readDeviceCookie,
  signDeviceCookie,
  verifyDeviceCookie,
} = await import('../signin-device-cookie')

const USER = 'user_abc'
const OTHER = 'user_xyz'
const DEVICE = 'aa'.repeat(16)

describe('sign / verify', () => {
  it('round-trips a device id for the same user', () => {
    const value = signDeviceCookie(USER, DEVICE)
    expect(value).toMatch(/^v1\.[0-9a-f]{32}\.[A-Za-z0-9_-]+$/)
    expect(verifyDeviceCookie(USER, value)).toBe(DEVICE)
  })

  it('rejects a cookie minted for a different user', () => {
    const value = signDeviceCookie(USER, DEVICE)
    expect(verifyDeviceCookie(OTHER, value)).toBeNull()
  })

  it('rejects a tampered mac', () => {
    const value = signDeviceCookie(USER, DEVICE)
    const flipped = value.slice(0, -1) + (value.endsWith('a') ? 'b' : 'a')
    expect(verifyDeviceCookie(USER, flipped)).toBeNull()
  })

  it('rejects a truncated mac (length guard before timingSafeEqual)', () => {
    const value = signDeviceCookie(USER, DEVICE)
    const truncated = value.slice(0, value.lastIndexOf('.') + 8)
    expect(verifyDeviceCookie(USER, truncated)).toBeNull()
  })

  it('rejects a garbage value', () => {
    expect(verifyDeviceCookie(USER, '')).toBeNull()
    expect(verifyDeviceCookie(USER, 'v1.not-hex.sig')).toBeNull()
    expect(verifyDeviceCookie(USER, `v2.${DEVICE}.aaaa`)).toBeNull()
  })

  it('refuses to sign a non-hex device id', () => {
    expect(() => signDeviceCookie(USER, 'nope')).toThrow(/32 hex/)
  })
})

describe('readDeviceCookie / namedCookie', () => {
  it('reads the per-user cookie and ignores a sibling userId prefix', () => {
    const ours = signDeviceCookie(USER, DEVICE)
    const otherId = 'bb'.repeat(16)
    const theirs = signDeviceCookie(`${USER}def`, otherId)
    const header = [
      `${deviceCookieName(`${USER}def`)}=${theirs}`,
      `${deviceCookieName(USER)}=${ours}`,
    ].join('; ')
    expect(readDeviceCookie(header, USER)).toBe(DEVICE)
    expect(namedCookie(header, deviceCookieName(`${USER}def`))).toBe(theirs)
  })

  it('returns null when the cookie is missing', () => {
    expect(readDeviceCookie('', USER)).toBeNull()
    expect(readDeviceCookie('session=abc', USER)).toBeNull()
  })

  it('uses the first matching pair when the header repeats the name', () => {
    const first = signDeviceCookie(USER, DEVICE)
    const second = signDeviceCookie(USER, 'cc'.repeat(16))
    const name = deviceCookieName(USER)
    expect(namedCookie(`${name}=${first}; ${name}=${second}`, name)).toBe(first)
  })
})

describe('mintDeviceId / attributes / name', () => {
  it('mints a 128-bit hex id', () => {
    const a = mintDeviceId()
    const b = mintDeviceId()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(b).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })

  it('is host-only, HttpOnly, Lax, 90 days', () => {
    expect(deviceCookieName(USER)).toBe(`qb.device.${USER}`)
    expect(deviceCookieAttributes(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: DEVICE_TTL_SECONDS,
    })
    expect(deviceCookieAttributes(false).secure).toBe(false)
    expect(DEVICE_TTL_SECONDS).toBe(7_776_000)
  })

  it('rejects a userId that cannot be a cookie-name token', () => {
    expect(() => deviceCookieName('user id')).toThrow(/cookie-name/)
    expect(() => deviceCookieName('user;abc')).toThrow(/cookie-name/)
  })
})
