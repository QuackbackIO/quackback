import { describe, it, expect } from 'vitest'
import {
  assumedResolutionEligible,
  confirmedResolutionEligible,
  outcomeStatus,
  ASSUMED_RESOLUTION_INACTIVITY_MINUTES,
} from '../assistant.involvement'

describe('assumedResolutionEligible', () => {
  const base = { gaveRealAnswer: true, inactivityMinutes: 60, customerReturned: false }

  it('is true after a real answer once the inactivity window passes', () => {
    expect(assumedResolutionEligible(base)).toBe(true)
  })

  it('never counts when Quinn only greeted (no real answer)', () => {
    expect(assumedResolutionEligible({ ...base, gaveRealAnswer: false })).toBe(false)
  })

  it('is voided when the customer returns needing help', () => {
    expect(assumedResolutionEligible({ ...base, customerReturned: true })).toBe(false)
  })

  it('waits for the inactivity window', () => {
    expect(
      assumedResolutionEligible({
        ...base,
        inactivityMinutes: ASSUMED_RESOLUTION_INACTIVITY_MINUTES - 1,
      })
    ).toBe(false)
    expect(
      assumedResolutionEligible({
        ...base,
        inactivityMinutes: ASSUMED_RESOLUTION_INACTIVITY_MINUTES,
      })
    ).toBe(true)
  })

  it('honors a custom threshold', () => {
    expect(assumedResolutionEligible({ ...base, inactivityMinutes: 5 }, 10)).toBe(false)
    expect(assumedResolutionEligible({ ...base, inactivityMinutes: 10 }, 10)).toBe(true)
  })
})

describe('confirmedResolutionEligible', () => {
  it('requires both a real answer and explicit affirmation', () => {
    expect(confirmedResolutionEligible({ gaveRealAnswer: true, explicitAffirmation: true })).toBe(
      true
    )
    expect(confirmedResolutionEligible({ gaveRealAnswer: true, explicitAffirmation: false })).toBe(
      false
    )
    expect(confirmedResolutionEligible({ gaveRealAnswer: false, explicitAffirmation: true })).toBe(
      false
    )
  })
})

describe('outcomeStatus', () => {
  it('maps outcome kind to the terminal status', () => {
    expect(outcomeStatus('confirmed')).toBe('resolved_confirmed')
    expect(outcomeStatus('assumed')).toBe('resolved_assumed')
  })
})
