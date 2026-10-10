/**
 * resolveFeatureFlags() reads the `feature_flags` column, a text column
 * parsed at read time on every request that resolves flags (settings
 * service, widget projection, activation, onboarding, telemetry). An
 * unguarded JSON.parse there means one corrupt row throws on every one of
 * those call sites. This suite pins the guarded, fail-safe behavior: corrupt
 * or non-object JSON resolves to defaults instead of throwing, and the
 * failure is logged once (not silently swallowed) so it can be found and
 * repaired. Blank / literal-'null' stays silent — that is the existing
 * "no stored flags yet" state, not corruption.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

describe('resolveFeatureFlags — corrupt feature_flags JSON', () => {
  beforeEach(() => {
    logErrorCalls.length = 0
  })

  it('does not throw and falls back to defaults on unparseable JSON', async () => {
    const { resolveFeatureFlags, DEFAULT_FEATURE_FLAGS } = await import('../settings.types')

    let result: unknown
    expect(() => {
      result = resolveFeatureFlags('{ not valid json')
    }).not.toThrow()
    expect(result).toEqual(DEFAULT_FEATURE_FLAGS)
  })

  it('logs the parse failure once, naming the column', async () => {
    const { resolveFeatureFlags } = await import('../settings.types')

    resolveFeatureFlags('{ not valid json')

    expect(logErrorCalls).toHaveLength(1)
    const [ctx, msg] = logErrorCalls[0]
    expect(ctx).toMatchObject({ column: 'feature_flags' })
    expect(ctx.err).toBeInstanceOf(Error)
    expect(msg).toMatch(/feature_flags/)
  })

  it('falls back to defaults on a non-object JSON value (array)', async () => {
    const { resolveFeatureFlags, DEFAULT_FEATURE_FLAGS } = await import('../settings.types')

    const result = resolveFeatureFlags('[1,2,3]')

    expect(result).toEqual(DEFAULT_FEATURE_FLAGS)
    expect(logErrorCalls).toHaveLength(1)
    expect(logErrorCalls[0][0]).toMatchObject({ column: 'feature_flags' })
  })

  it('falls back to defaults on a non-object JSON value (string)', async () => {
    const { resolveFeatureFlags, DEFAULT_FEATURE_FLAGS } = await import('../settings.types')

    const result = resolveFeatureFlags('"enabled"')

    expect(result).toEqual(DEFAULT_FEATURE_FLAGS)
    expect(logErrorCalls).toHaveLength(1)
  })

  it('treats the literal string "null" as blank — no stored flags, no error log', async () => {
    const { resolveFeatureFlags, DEFAULT_FEATURE_FLAGS } = await import('../settings.types')

    const result = resolveFeatureFlags('null')

    expect(result).toEqual(DEFAULT_FEATURE_FLAGS)
    expect(logErrorCalls).toHaveLength(0)
  })

  it('treats an empty string as blank — no stored flags, no error log', async () => {
    const { resolveFeatureFlags, DEFAULT_FEATURE_FLAGS } = await import('../settings.types')

    const result = resolveFeatureFlags('')

    expect(result).toEqual(DEFAULT_FEATURE_FLAGS)
    expect(logErrorCalls).toHaveLength(0)
  })

  it('treats null/undefined as blank — no stored flags, no error log', async () => {
    const { resolveFeatureFlags, DEFAULT_FEATURE_FLAGS } = await import('../settings.types')

    expect(resolveFeatureFlags(null)).toEqual(DEFAULT_FEATURE_FLAGS)
    expect(resolveFeatureFlags(undefined)).toEqual(DEFAULT_FEATURE_FLAGS)
    expect(logErrorCalls).toHaveLength(0)
  })

  it('still applies stored booleans for valid JSON — no behavior change', async () => {
    const { resolveFeatureFlags } = await import('../settings.types')

    const result = resolveFeatureFlags(
      JSON.stringify({ helpCenter: true, statusPage: true, changelog: false })
    )

    expect(result.helpCenter).toBe(true)
    expect(result.statusPage).toBe(true)
    expect(result.changelog).toBe(false)
    // feedback is always forced on regardless of stored value.
    expect(result.feedback).toBe(true)
    expect(logErrorCalls).toHaveLength(0)
  })
})
