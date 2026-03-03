import { describe, it, expect } from 'vitest'
import { levelFromFlags } from '../subscription.types'

describe('levelFromFlags', () => {
  it('returns "all" when both flags are true', () => {
    expect(levelFromFlags(true, true)).toBe('all')
  })

  it('returns "status_only" when only notifyStatusChanges is true', () => {
    expect(levelFromFlags(false, true)).toBe('status_only')
  })

  it('returns "none" when both flags are false', () => {
    expect(levelFromFlags(false, false)).toBe('none')
  })

  it('returns "none" when only notifyComments is true', () => {
    // Edge case: comments without status changes treated as none
    expect(levelFromFlags(true, false)).toBe('none')
  })
})
