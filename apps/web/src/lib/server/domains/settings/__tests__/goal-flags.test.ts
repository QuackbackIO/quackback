import { describe, expect, it } from 'vitest'
import { DEFAULT_FEATURE_FLAGS, flagsForGoals } from '../settings.types'

describe('modules for selected goals', () => {
  it('enables the union of Support, Help center and Status', () => {
    const result = flagsForGoals(DEFAULT_FEATURE_FLAGS, [
      'customer_support',
      'help_center',
      'status_page',
    ])
    expect(result.flags).toEqual({
      ...DEFAULT_FEATURE_FLAGS,
      supportInbox: true,
      supportTickets: true,
      helpCenter: true,
      statusPage: true,
    })
    expect(result.enabledModules).toEqual(['Support', 'Help Center', 'Status'])
  })
  it('never turns another product off and reports only new modules', () => {
    const before = {
      ...DEFAULT_FEATURE_FLAGS,
      supportInbox: true,
      supportTickets: true,
      feedback: false,
      statusPage: true,
    }
    expect(flagsForGoals(before, ['help_center'])).toEqual({
      flags: { ...before, helpCenter: true },
      enabledModules: ['Help Center'],
    })
    expect(flagsForGoals(before, [])).toEqual({ flags: before, enabledModules: [] })
  })
})
