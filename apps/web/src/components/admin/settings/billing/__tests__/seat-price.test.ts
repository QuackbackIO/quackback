import { describe, expect, it } from 'vitest'
import { seatRecurringTotalCents, seatUnitCents } from '../seat-price'

const plan = { priceMonthlyCents: 3000, priceYearlyCents: 28800 }

describe('seatUnitCents', () => {
  it('uses the monthly sticker when the interval is unknown', () => {
    expect(seatUnitCents(plan, null)).toBe(3000)
    expect(seatUnitCents(plan, undefined)).toBe(3000)
  })

  it('uses the monthly sticker on a monthly interval', () => {
    expect(seatUnitCents(plan, 'monthly')).toBe(3000)
  })

  it('uses yearly/12 only when the interval is annual', () => {
    expect(seatUnitCents(plan, 'annual')).toBe(2400)
  })
})

describe('seatRecurringTotalCents', () => {
  it('omits period totals when the interval is unknown', () => {
    expect(seatRecurringTotalCents(plan, 10, null)).toBeNull()
  })

  it('quotes monthly and yearly totals from the known interval', () => {
    expect(seatRecurringTotalCents(plan, 10, 'monthly')).toEqual({ cents: 30_000, suffix: '/mo' })
    expect(seatRecurringTotalCents(plan, 10, 'annual')).toEqual({ cents: 288_000, suffix: '/yr' })
  })
})
