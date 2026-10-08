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

  it('say when a used-up allowance comes back: the end of its window', () => {
    const end = new Date('2026-11-01T00:00:00.000Z')
    expect(aiAllowance(1_000, 1_000, end)).toEqual({
      credits: 'used',
      resetsAt: '2026-11-01T00:00:00.000Z',
    })
    expect(aiAllowance(1_000, 10, end)).toEqual({ credits: 'available', resetsAt: null })
    expect(aiAllowance(null, 10, end)).toEqual({ credits: 'available', resetsAt: null })
    expect(aiAllowance(0, 0, end)).toEqual({ credits: 'none', resetsAt: null })
  })
})
