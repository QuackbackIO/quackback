// @vitest-environment node
/**
 * The monthly email cap. Only broadcast mail (changelog and status-page sends)
 * draws on it. When the included emails are used up the refusal says email
 * sending is used up and points at the plan, quoting no counts or prices.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TierLimitError } from '../../../errors/tier-limit-error'

const state = vi.hoisted(() => ({
  emailsPerMonth: null as number | null,
  sent: 0,
  countCalls: 0,
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => ({ emailsPerMonth: state.emailsPerMonth, features: {} }),
}))

vi.mock('@/lib/server/email/email-budget', () => ({
  emailsSentThisMonth: async () => {
    state.countCalls++
    return state.sent
  },
}))

const { enforceEmailBudget, emailBudgetAvailable } = await import('../tier-enforce')

async function refusalOf(): Promise<TierLimitError> {
  const error = await enforceEmailBudget().catch((err: unknown) => err)
  expect(error).toBeInstanceOf(TierLimitError)
  return error as TierLimitError
}

beforeEach(() => {
  state.emailsPerMonth = 10_000
  state.sent = 0
  state.countCalls = 0
})

describe('enforceEmailBudget', () => {
  it('lets broadcast mail through while the included emails last', async () => {
    state.sent = 9_999
    await expect(enforceEmailBudget()).resolves.toBeUndefined()
  })

  it('says email sending for the month is used up, and to upgrade for more', async () => {
    state.sent = 10_000
    expect((await refusalOf()).message).toBe(
      'Email sending for this month is used up. Upgrade your plan for more.'
    )
  })

  it('quotes no counts or prices in the refusal', async () => {
    state.sent = 12_345
    const { message } = await refusalOf()
    expect(message).not.toMatch(/\d/)
    expect(message).not.toMatch(/[$€£]/)
  })

  it('reads no count when the plan sets no email limit', async () => {
    state.emailsPerMonth = null
    await expect(enforceEmailBudget()).resolves.toBeUndefined()
    expect(state.countCalls).toBe(0)
  })

  it('says email is not included when the plan has no email allowance at all', async () => {
    state.emailsPerMonth = 0
    expect((await refusalOf()).message).toBe(
      'Outbound email is not included on your plan. Upgrade to enable it.'
    )
  })
})

describe('emailBudgetAvailable', () => {
  it('is false once the included emails are used up, and true under them', async () => {
    state.sent = 10_000
    await expect(emailBudgetAvailable()).resolves.toBe(false)
    state.sent = 9_000
    await expect(emailBudgetAvailable()).resolves.toBe(true)
  })
})
