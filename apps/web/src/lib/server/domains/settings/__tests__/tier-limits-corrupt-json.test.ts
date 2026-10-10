/**
 * getTierLimits() reads the `tier_limits` column, a text column parsed once
 * per (cached) workspace. An unguarded JSON.parse there means one corrupt
 * row throws on every tier-limit check for that workspace until the cache is
 * invalidated. This suite pins the guarded, fail-safe behavior: corrupt or
 * non-object JSON is treated the same as "no stored row" — the documented,
 * already-tested fallback (self-hosted: OSS_TIER_LIMITS; cloud: the signed
 * projection's floor, see resolveEffectiveTierLimits) — instead of throwing,
 * and the failure is logged once so it can be found and repaired.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  tierLimits: null as string | null,
}))

vi.mock('@/lib/server/db', () => ({
  settings: { tierLimits: 'tier_limits', cloud: 'cloud' },
  db: {
    select: () => ({
      from: () => ({
        limit: async () => [{ tierLimits: hoisted.tierLimits, cloud: null }],
      }),
    }),
  },
}))

const logErrorCalls: Array<[Record<string, unknown>, string]> = []

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (ctx: Record<string, unknown>, msg: string) => {
        logErrorCalls.push([ctx, msg])
      },
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    }),
  },
}))

describe('getTierLimits — corrupt tier_limits JSON', () => {
  beforeEach(async () => {
    logErrorCalls.length = 0
    hoisted.tierLimits = null
    const { invalidateTierLimitsCache } = await import('../tier-limits.service')
    invalidateTierLimitsCache()
  })

  it('does not throw and falls back to OSS defaults on unparseable JSON', async () => {
    hoisted.tierLimits = '{ not valid json'
    const { getTierLimits } = await import('../tier-limits.service')
    const { OSS_TIER_LIMITS } = await import('../tier-limits.types')

    await expect(getTierLimits()).resolves.toEqual(OSS_TIER_LIMITS)
  })

  it('logs the parse failure once, naming the column', async () => {
    hoisted.tierLimits = '{ not valid json'
    const { getTierLimits } = await import('../tier-limits.service')

    await getTierLimits()

    expect(logErrorCalls).toHaveLength(1)
    const [ctx, msg] = logErrorCalls[0]
    expect(ctx).toMatchObject({ column: 'tier_limits' })
    expect(ctx.err).toBeInstanceOf(Error)
    expect(msg).toMatch(/tier_limits/)
  })

  it('falls back to OSS defaults on a non-object JSON value (a bare string)', async () => {
    hoisted.tierLimits = '"unlimited"'
    const { getTierLimits } = await import('../tier-limits.service')
    const { OSS_TIER_LIMITS } = await import('../tier-limits.types')

    await expect(getTierLimits()).resolves.toEqual(OSS_TIER_LIMITS)
    expect(logErrorCalls).toHaveLength(1)
  })

  it('still applies a valid stored row — no behavior change', async () => {
    hoisted.tierLimits = JSON.stringify({ maxBoards: 5 })
    const { getTierLimits } = await import('../tier-limits.service')

    const result = await getTierLimits()

    expect(result.maxBoards).toBe(5)
    expect(logErrorCalls).toHaveLength(0)
  })

  it('treats an absent row as before — OSS defaults, no log', async () => {
    hoisted.tierLimits = null
    const { getTierLimits } = await import('../tier-limits.service')
    const { OSS_TIER_LIMITS } = await import('../tier-limits.types')

    await expect(getTierLimits()).resolves.toEqual(OSS_TIER_LIMITS)
    expect(logErrorCalls).toHaveLength(0)
  })
})
