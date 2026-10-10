/**
 * Tests for the known-device tracker. `isDeviceUnseen` claims; on
 * notification failure the caller `forgetDevice`s so the next sign-in
 * re-fires. Members are cookie ids under v3.
 *
 * The tracker's subject is that protocol, so the set primitives it
 * delegates to (`kv/pg-kv.ts`) are stubbed here. Their own guarantees — one
 * statement per claim, and the workspace discriminator on every row — are proved
 * against a real database in `kv/__tests__/pg-kv-semantics.db.test.ts` and
 * `kv/__tests__/workspace-separation.db.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockClaimCounted = vi.fn()
const mockMemberTouch = vi.fn()
const mockRemove = vi.fn()

vi.mock('@/lib/server/kv/pg-kv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/kv/pg-kv')>()),
  kvSetMemberClaimCounted: mockClaimCounted,
  kvSetMemberTouch: mockMemberTouch,
  kvSetMemberRemove: mockRemove,
}))

const { formatSignInDevice, isDeviceUnseen, forgetDevice } =
  await import('../signin-device-tracker')

const CHROME_WIN_129 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
const CHROME_WIN_130 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const FIREFOX_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('formatSignInDevice', () => {
  it('strips browser versions so an auto-update stays the same line', () => {
    expect(formatSignInDevice(CHROME_WIN_129)).toBe('Chrome on Windows')
    expect(formatSignInDevice(CHROME_WIN_130)).toBe('Chrome on Windows')
  })

  it('differs across browser families', () => {
    expect(formatSignInDevice(FIREFOX_WIN)).toBe('Firefox on Windows')
    expect(formatSignInDevice(CHROME_WIN_129)).not.toBe(formatSignInDevice(FIREFOX_WIN))
  })

  it('differs across OS / platform', () => {
    expect(formatSignInDevice(CHROME_IOS)).toMatch(/Chrome on iOS/i)
    expect(formatSignInDevice(CHROME_WIN_129)).not.toBe(formatSignInDevice(CHROME_IOS))
  })

  it('collapses empty and unparseable UAs onto one line', () => {
    expect(formatSignInDevice('')).toBe('Unknown device')
    expect(formatSignInDevice('   ')).toBe('Unknown device')
    expect(formatSignInDevice('???')).toBe('Unknown device')
  })
})

describe('isDeviceUnseen', () => {
  it('returns false for the first recorded device (silent seed)', async () => {
    mockClaimCounted.mockResolvedValueOnce({ claimed: true, liveCount: 1 })
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(false)
  })

  it('returns true when the claim takes an additional member', async () => {
    mockClaimCounted.mockResolvedValueOnce({ claimed: true, liveCount: 2 })
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(true)
  })

  it('returns false when the member was already present', async () => {
    mockClaimCounted.mockResolvedValueOnce({ claimed: false, liveCount: 2 })
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(false)
    expect(mockMemberTouch).toHaveBeenCalledWith('user:devices:v3:user_abc', 'fp', 7_776_000)
  })

  it('does not slide TTL on a first-device silent seed', async () => {
    mockClaimCounted.mockResolvedValueOnce({ claimed: true, liveCount: 1 })
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(false)
    expect(mockMemberTouch).not.toHaveBeenCalled()
  })

  it('claims the cookie id under the v3 user set key with the 90-day TTL', async () => {
    mockClaimCounted.mockResolvedValueOnce({ claimed: true, liveCount: 2 })
    await isDeviceUnseen('user_abc', 'fp')
    expect(mockClaimCounted).toHaveBeenCalledTimes(1)
    expect(mockClaimCounted).toHaveBeenCalledWith('user:devices:v3:user_abc', 'fp', 7_776_000)
  })

  it('atomic across concurrent first-sights — only one caller gets a claim', async () => {
    mockClaimCounted
      .mockResolvedValueOnce({ claimed: true, liveCount: 2 })
      .mockResolvedValueOnce({ claimed: false, liveCount: 2 })
    const [a, b] = await Promise.all([
      isDeviceUnseen('user_abc', 'fp'),
      isDeviceUnseen('user_abc', 'fp'),
    ])
    expect([a, b].sort()).toEqual([false, true])
  })

  it('fails closed on a store error (returns false, no notification spam)', async () => {
    mockClaimCounted.mockRejectedValueOnce(new Error('store down'))
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(false)
  })
})

describe('forgetDevice', () => {
  it('removes the cookie id from the user set', async () => {
    mockRemove.mockResolvedValueOnce(undefined)
    await forgetDevice('user_abc', 'fp')
    expect(mockRemove).toHaveBeenCalledWith('user:devices:v3:user_abc', 'fp')
  })

  it('swallows store errors', async () => {
    mockRemove.mockRejectedValueOnce(new Error('store down'))
    await expect(forgetDevice('user_abc', 'fp')).resolves.toBeUndefined()
  })
})
