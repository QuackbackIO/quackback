import { describe, it, expect } from 'vitest'
import { canEmailVisitor } from '../reply-capability'

describe('canEmailVisitor', () => {
  it('is false when email transport is not configured (cannot send at all)', () => {
    expect(
      canEmailVisitor({ emailConfigured: false, preChatEmail: 'optional', visitorHasEmail: true })
    ).toBe(false)
  })

  it('is false when capture is off and no address is on file', () => {
    expect(
      canEmailVisitor({ emailConfigured: true, preChatEmail: 'off', visitorHasEmail: false })
    ).toBe(false)
  })

  it('is true when capture is off but an address is already on file', () => {
    expect(
      canEmailVisitor({ emailConfigured: true, preChatEmail: 'off', visitorHasEmail: true })
    ).toBe(true)
  })

  it('is true when capture is optional or required (an address will be obtained)', () => {
    expect(
      canEmailVisitor({ emailConfigured: true, preChatEmail: 'optional', visitorHasEmail: false })
    ).toBe(true)
    expect(
      canEmailVisitor({ emailConfigured: true, preChatEmail: 'required', visitorHasEmail: false })
    ).toBe(true)
  })
})
