/**
 * The AI allowance window. A workspace on a trial gets ONE allowance for the
 * whole trial, not one per calendar month the trial happens to touch; once the
 * trial is over, calendar months resume. A workspace with no commercial config
 * (self-hosted) always counts by calendar month.
 *
 * The usage counter is replaced by a fake that sums fixture rows inside the
 * [start, end) range it is asked about, so the assertions fail whenever the
 * gate asks about the wrong window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TierLimitError } from '../../../errors/tier-limit-error'

const state = vi.hoisted(() => ({
  cap: null as number | null,
  cloud: {
    enabled: false,
    trialActive: false,
    trialStartedAt: null as string | null,
    trialExpiresAt: null as string | null,
  },
  rows: [] as Array<{ at: string; tokens: number }>,
  counterCalls: 0,
}))

function sumBetween(start: Date, end: Date): number {
  state.counterCalls++
  return state.rows
    .filter((r) => {
      const t = Date.parse(r.at)
      return t >= start.getTime() && t < end.getTime()
    })
    .reduce((acc, r) => acc + r.tokens, 0)
}

vi.mock('@/lib/server/domains/ai/usage-counter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/ai/usage-counter')>()),
  aiTokensInWindow: async (start: Date, end: Date) => sumBetween(start, end),
  aiTokensThisMonth: async () => {
    const now = new Date()
    return sumBetween(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    )
  },
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => ({ aiTokensPerMonth: state.cap, features: {} }),
}))

vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig: async () => ({ ...state.cloud }),
}))

const { enforceAiTokenBudget } = await import('../tier-enforce')
const { aiBudgetWindow } = await import('@/lib/server/domains/ai/ai-budget')

const TRIAL = {
  enabled: true,
  trialActive: true,
  trialStartedAt: '2026-10-25T09:00:00.000Z',
  trialExpiresAt: '2026-11-08T09:00:00.000Z',
}

beforeEach(() => {
  state.cap = null
  state.cloud = { enabled: false, trialActive: false, trialStartedAt: null, trialExpiresAt: null }
  state.rows = []
  state.counterCalls = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('aiBudgetWindow', () => {
  it('uses the calendar month when there is no commercial config', () => {
    const w = aiBudgetWindow(
      { enabled: false, trialActive: false, trialStartedAt: null, trialExpiresAt: null },
      new Date('2026-11-02T12:00:00Z')
    )
    expect(w.kind).toBe('month')
    expect(w.start.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })

  it('ignores trial dates when commercial mode is off', () => {
    const w = aiBudgetWindow({ ...TRIAL, enabled: false }, new Date('2026-11-02T12:00:00Z'))
    expect(w.kind).toBe('month')
    expect(w.start.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it('uses the trial window on both sides of a month boundary', () => {
    const october = aiBudgetWindow(TRIAL, new Date('2026-10-28T12:00:00Z'))
    const november = aiBudgetWindow(TRIAL, new Date('2026-11-02T12:00:00Z'))
    for (const w of [october, november]) {
      expect(w.kind).toBe('trial')
      expect(w.start.toISOString()).toBe(TRIAL.trialStartedAt)
      expect(w.end.toISOString()).toBe(TRIAL.trialExpiresAt)
    }
  })

  it('falls back to the month when the trial start is unknown', () => {
    const w = aiBudgetWindow({ ...TRIAL, trialStartedAt: null }, new Date('2026-11-02T12:00:00Z'))
    expect(w.kind).toBe('month')
  })

  it('starts the first post-trial month at the trial end', () => {
    const w = aiBudgetWindow(
      { ...TRIAL, trialActive: false },
      new Date('2026-11-20T12:00:00Z')
    )
    expect(w.kind).toBe('month')
    expect(w.start.toISOString()).toBe(TRIAL.trialExpiresAt)
    expect(w.end.toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })

  it('resumes plain calendar months after that', () => {
    const w = aiBudgetWindow(
      { ...TRIAL, trialActive: false },
      new Date('2026-12-03T12:00:00Z')
    )
    expect(w.kind).toBe('month')
    expect(w.start.toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })
})

describe('enforceAiTokenBudget window selection', () => {
  it('a trial crossing a month boundary gets one allowance, not two', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z'), toFake: ['Date'] })
    state.cap = 1000
    state.cloud = { ...TRIAL }
    state.rows = [
      { at: '2026-10-27T10:00:00Z', tokens: 900 },
      { at: '2026-11-01T10:00:00Z', tokens: 200 },
    ]
    await expect(enforceAiTokenBudget()).rejects.toThrow(TierLimitError)
  })

  it('names the trial rather than the month in the refusal', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z'), toFake: ['Date'] })
    state.cap = 1000
    state.cloud = { ...TRIAL }
    state.rows = [{ at: '2026-10-27T10:00:00Z', tokens: 1000 }]
    await expect(enforceAiTokenBudget()).rejects.toThrow(/trial/)
  })

  it('allows calls while the trial total is under the cap', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z'), toFake: ['Date'] })
    state.cap = 1000
    state.cloud = { ...TRIAL }
    state.rows = [
      { at: '2026-10-27T10:00:00Z', tokens: 400 },
      { at: '2026-11-01T10:00:00Z', tokens: 200 },
    ]
    await expect(enforceAiTokenBudget()).resolves.toBeUndefined()
  })

  it('does not charge trial usage to the first month after the trial', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z'), toFake: ['Date'] })
    state.cap = 1000
    state.cloud = { ...TRIAL, trialActive: false }
    state.rows = [
      { at: '2026-11-02T10:00:00Z', tokens: 900 },
      { at: '2026-11-15T10:00:00Z', tokens: 200 },
    ]
    await expect(enforceAiTokenBudget()).resolves.toBeUndefined()
  })

  it('self-hosted keeps counting by calendar month', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z'), toFake: ['Date'] })
    state.cap = 1000
    state.rows = [
      { at: '2026-10-27T10:00:00Z', tokens: 900 },
      { at: '2026-11-01T10:00:00Z', tokens: 200 },
    ]
    await expect(enforceAiTokenBudget()).resolves.toBeUndefined()
    state.rows.push({ at: '2026-11-02T08:00:00Z', tokens: 800 })
    await expect(enforceAiTokenBudget()).rejects.toThrow(/this month/)
  })

  it('an unlimited plan never reads usage', async () => {
    state.cap = null
    state.cloud = { ...TRIAL }
    await expect(enforceAiTokenBudget()).resolves.toBeUndefined()
    expect(state.counterCalls).toBe(0)
  })
})
