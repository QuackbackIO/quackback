/**
 * Tests for the device-fingerprint tracker. Two-phase API (isDeviceUnseen →
 * markDeviceSeen | forgetDevice) so notification failures can roll back the
 * claim and re-fire on the next sign-in.
 *
 * The tracker's subject is that two-phase protocol, so the set primitives it
 * delegates to (`kv/pg-kv.ts`) are stubbed here. Their own guarantees — one
 * statement per claim, and the tenant discriminator on every row — are proved
 * against a real database in `kv/__tests__/pg-kv-semantics.db.test.ts` and
 * `kv/__tests__/tenant-separation.db.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockClaim = vi.fn()
const mockTouch = vi.fn()
const mockRemove = vi.fn()

vi.mock('@/lib/server/kv/pg-kv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/kv/pg-kv')>()),
  kvSetMemberClaim: mockClaim,
  kvSetTouch: mockTouch,
  kvSetMemberRemove: mockRemove,
}))

const { computeDeviceFingerprint, isDeviceUnseen, markDeviceSeen, forgetDevice } =
  await import('../signin-device-tracker')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('computeDeviceFingerprint', () => {
  it('truncates IPv4 to /24 before hashing', () => {
    const a = computeDeviceFingerprint('Mozilla/5.0', '203.0.113.42')
    const b = computeDeviceFingerprint('Mozilla/5.0', '203.0.113.99')
    expect(a).toBe(b)
  })

  it('differs on UA change', () => {
    const a = computeDeviceFingerprint('Mozilla/5.0', '203.0.113.42')
    const b = computeDeviceFingerprint('Different/5.0', '203.0.113.42')
    expect(a).not.toBe(b)
  })

  it('differs on /24 change', () => {
    expect(computeDeviceFingerprint('UA', '203.0.113.42')).not.toBe(
      computeDeviceFingerprint('UA', '203.0.114.42')
    )
  })

  it('hashes IPv6 whole (no truncation)', () => {
    expect(computeDeviceFingerprint('UA', '2001:db8::1')).not.toBe(
      computeDeviceFingerprint('UA', '2001:db8::2')
    )
  })

  it('returns 32-char hex', () => {
    expect(computeDeviceFingerprint('UA', '203.0.113.42')).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('isDeviceUnseen', () => {
  it('returns true when the claim takes the member', async () => {
    mockClaim.mockResolvedValueOnce(true)
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(true)
  })

  it('returns false when the member was already present', async () => {
    mockClaim.mockResolvedValueOnce(false)
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(false)
  })

  it('claims the fingerprint under the user set key with the 90-day TTL', async () => {
    mockClaim.mockResolvedValueOnce(true)
    await isDeviceUnseen('user_abc', 'fp')
    // One call, so the claim and the expiry cannot separate: a caller that
    // crashes before markDeviceSeen still leaves an expiring member.
    expect(mockClaim).toHaveBeenCalledTimes(1)
    expect(mockClaim).toHaveBeenCalledWith('user:devices:user_abc', 'fp', 7_776_000)
  })

  it('atomic across concurrent first-sights — only one caller gets true', async () => {
    mockClaim.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const [a, b] = await Promise.all([
      isDeviceUnseen('user_abc', 'fp'),
      isDeviceUnseen('user_abc', 'fp'),
    ])
    expect([a, b].sort()).toEqual([false, true])
  })

  it('fails closed on a store error (returns false, no notification spam)', async () => {
    mockClaim.mockRejectedValueOnce(new Error('store down'))
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(false)
  })
})

describe('markDeviceSeen', () => {
  it('slides the 90-day TTL forward', async () => {
    mockTouch.mockResolvedValueOnce(undefined)
    await markDeviceSeen('user_abc')
    expect(mockTouch).toHaveBeenCalledWith('user:devices:user_abc', 7_776_000)
  })

  it('swallows store errors', async () => {
    mockTouch.mockRejectedValueOnce(new Error('store down'))
    await expect(markDeviceSeen('user_abc')).resolves.toBeUndefined()
  })
})

describe('forgetDevice', () => {
  it('removes the fingerprint from the user set', async () => {
    mockRemove.mockResolvedValueOnce(undefined)
    await forgetDevice('user_abc', 'fp')
    expect(mockRemove).toHaveBeenCalledWith('user:devices:user_abc', 'fp')
  })

  it('swallows store errors', async () => {
    mockRemove.mockRejectedValueOnce(new Error('store down'))
    await expect(forgetDevice('user_abc', 'fp')).resolves.toBeUndefined()
  })
})
