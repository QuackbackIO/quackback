import { describe, expect, it } from 'vitest'
import { seatInviteBlocked, seatUpgradePlanName } from '../seat-usage'

describe('seatInviteBlocked', () => {
  it('is open when there is no cap', () => {
    expect(seatInviteBlocked({ used: 40, limit: null })).toBe(false)
    expect(seatInviteBlocked(undefined)).toBe(false)
  })

  it('locks at the Growth/Free cap of 1', () => {
    expect(seatInviteBlocked({ used: 1, limit: 1 })).toBe(true)
    expect(seatInviteBlocked({ used: 0, limit: 1 })).toBe(false)
  })
})

describe('seatUpgradePlanName', () => {
  it('names Pro to lift a one-seat cap', () => {
    expect(seatUpgradePlanName(1)).toBe('Pro')
  })

  it('names Scale to lift a Pro cap', () => {
    expect(seatUpgradePlanName(10)).toBe('Scale')
  })
})
