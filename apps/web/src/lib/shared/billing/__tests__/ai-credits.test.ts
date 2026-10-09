import { describe, expect, it } from 'vitest'
import { aiAllowance, aiCreditsState } from '../ai-credits'

describe('AI credits', () => {
  it('are available with no cap, or while usage is under it, trials included', () => {
    expect(aiCreditsState(null, 10_000_000)).toBe('available')
    expect(aiCreditsState(1_000, 999)).toBe('available')
  })

  it('are none on a plan without AI and used once the cap is reached', () => {
    expect(aiCreditsState(0, 0)).toBe('none')
    expect(aiCreditsState(1_000, 1_000)).toBe('used')
  })

  it('say when a used-up allowance comes back: the end of its month', () => {
    const month = { kind: 'month' as const, end: new Date('2026-11-01T00:00:00.000Z') }
    expect(aiAllowance(1_000, 1_000, month)).toEqual({
      credits: 'used',
      resetsAt: '2026-11-01T00:00:00.000Z',
      trial: false,
    })
    expect(aiAllowance(1_000, 10, month)).toEqual({
      credits: 'available',
      resetsAt: null,
      trial: false,
    })
    expect(aiAllowance(null, 10, month)).toEqual({
      credits: 'available',
      resetsAt: null,
      trial: false,
    })
    expect(aiAllowance(0, 0, month)).toEqual({ credits: 'none', resetsAt: null, trial: false })
  })

  it('name no reset in a trial, whose end is not a reset: what follows depends on the plan', () => {
    const trial = { kind: 'trial' as const, end: new Date('2026-10-22T15:00:00.000Z') }
    expect(aiAllowance(1_000, 1_000, trial)).toEqual({
      credits: 'used',
      resetsAt: null,
      trial: true,
    })
  })
})
