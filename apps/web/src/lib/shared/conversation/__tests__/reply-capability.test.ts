import { describe, it, expect } from 'vitest'
import { canEmailVisitor } from '../reply-capability'

// The widget never collects emails inline (GH issue #300), so an email reply
// is only possible when transport is configured AND an address is already on
// file (verified identity, or agent/email-channel capture).
describe('canEmailVisitor', () => {
  it('is false when email transport is not configured', () => {
    expect(canEmailVisitor({ emailConfigured: false, visitorHasEmail: true })).toBe(false)
  })

  it('is false when no address is on file', () => {
    expect(canEmailVisitor({ emailConfigured: true, visitorHasEmail: false })).toBe(false)
  })

  it('is true when configured and an address is on file', () => {
    expect(canEmailVisitor({ emailConfigured: true, visitorHasEmail: true })).toBe(true)
  })
})
