import { describe, expect, it } from 'vitest'
import { seatAddAvailable, seatInviteBlocked } from '../seat-usage'

describe('seatInviteBlocked', () => {
  it('is open when there is no cap', () => {
    expect(seatInviteBlocked({ used: 40, limit: null })).toBe(false)
    expect(seatInviteBlocked(undefined)).toBe(false)
  })

  it('locks at the Free cap of 1', () => {
    expect(seatInviteBlocked({ used: 1, limit: 1 })).toBe(true)
    expect(seatInviteBlocked({ used: 0, limit: 1 })).toBe(false)
  })

  it('locks when pending invites fill the last purchased seats', () => {
    expect(seatInviteBlocked({ used: 10, limit: 10, members: 8, pendingInvites: 2 })).toBe(true)
  })
})

describe('seatAddAvailable', () => {
  it('is true only when the server marked the seat purchase path', () => {
    expect(seatAddAvailable({ used: 10, limit: 10, addSeatAvailable: true })).toBe(true)
    expect(seatAddAvailable({ used: 1, limit: 1, addSeatAvailable: false })).toBe(false)
    expect(seatAddAvailable(undefined)).toBe(false)
  })
})
