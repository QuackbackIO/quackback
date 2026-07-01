import { describe, it, expect } from 'vitest'
import { chatAvailable } from '../presence'

// "Available" drives the online dot + copy. A live agent always counts as
// available; when office hours are configured (withinOfficeHours non-null) the
// schedule also marks the team available, but a present agent still overrides
// closed hours.
describe('chatAvailable', () => {
  it('with no office-hours schedule, follows agent presence', () => {
    expect(chatAvailable(true, null)).toBe(true)
    expect(chatAvailable(false, null)).toBe(false)
  })

  it('is available within office hours regardless of agent presence', () => {
    expect(chatAvailable(false, true)).toBe(true)
    expect(chatAvailable(true, true)).toBe(true)
  })

  it('outside office hours, a present agent still makes it available', () => {
    expect(chatAvailable(true, false)).toBe(true)
    expect(chatAvailable(false, false)).toBe(false)
  })
})
