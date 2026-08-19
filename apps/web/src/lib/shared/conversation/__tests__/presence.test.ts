import { describe, it, expect } from 'vitest'
import { conversationAvailable } from '../presence'

// "Available" drives the online dot + copy. A live agent always counts as
// available; when office hours are configured (withinOfficeHours non-null) the
// schedule also marks the team available, but a present agent still overrides
// closed hours.
describe('conversationAvailable', () => {
  it('with no office-hours schedule, follows agent presence', () => {
    expect(conversationAvailable(true, null)).toBe(true)
    expect(conversationAvailable(false, null)).toBe(false)
  })

  it('is available within office hours regardless of agent presence', () => {
    expect(conversationAvailable(false, true)).toBe(true)
    expect(conversationAvailable(true, true)).toBe(true)
  })

  it('outside office hours, a present agent still makes it available', () => {
    expect(conversationAvailable(true, false)).toBe(true)
    expect(conversationAvailable(false, false)).toBe(false)
  })
})
