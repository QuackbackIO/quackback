import { describe, it, expect } from 'vitest'
import { allowDecision, denyDecision, isAllowed, ANONYMOUS_ACTOR } from '../types'

describe('policy decisions', () => {
  it('allowDecision returns an allowed decision', () => {
    const decision = allowDecision()
    expect(decision.allowed).toBe(true)
    expect(isAllowed(decision)).toBe(true)
  })

  it('denyDecision carries a reason string', () => {
    const decision = denyDecision('not in audience')
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reason).toBe('not in audience')
    }
    expect(isAllowed(decision)).toBe(false)
  })

  it('ANONYMOUS_ACTOR has empty segment set, anonymous principal type, no role', () => {
    expect(ANONYMOUS_ACTOR.principalId).toBeNull()
    expect(ANONYMOUS_ACTOR.role).toBeNull()
    expect(ANONYMOUS_ACTOR.principalType).toBe('anonymous')
    expect(ANONYMOUS_ACTOR.segmentIds.size).toBe(0)
  })
})
