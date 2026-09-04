import { describe, expect, it } from 'vitest'
import {
  annualSavingsCents,
  annualSavingsLabel,
  annualSavingsPercent,
  checkoutPath,
  checkoutSummary,
  parseCheckoutSearch,
} from '../checkout-path'

const pro = { priceMonthlyCents: 5900, priceYearlyCents: 59000, billedPer: 'seat' as const }

describe('checkoutPath', () => {
  it('encodes only what was given', () => {
    expect(checkoutPath()).toBe('/admin/settings/billing/checkout')
    expect(checkoutPath({ plan: 'pro' })).toBe('/admin/settings/billing/checkout?plan=pro')
    expect(checkoutPath({ plan: 'pro', period: 'monthly', seats: 3 })).toBe(
      '/admin/settings/billing/checkout?plan=pro&period=monthly&seats=3'
    )
    expect(checkoutPath({ plan: 'pro', branding: true })).toBe(
      '/admin/settings/billing/checkout?plan=pro&branding=true'
    )
    expect(checkoutPath({ plan: 'pro', branding: false })).toBe(
      '/admin/settings/billing/checkout?plan=pro'
    )
  })
})

describe('parseCheckoutSearch', () => {
  it('keeps valid values and drops the rest', () => {
    expect(
      parseCheckoutSearch({ plan: 'scale', period: 'annual', seats: '4', branding: 'true' })
    ).toEqual({
      plan: 'scale',
      period: 'annual',
      seats: 4,
      branding: true,
    })
    expect(parseCheckoutSearch({ plan: 'free', period: 'weekly', seats: '0' })).toEqual({})
    expect(parseCheckoutSearch({ branding: 'false' })).toEqual({})
    expect(parseCheckoutSearch({ branding: 'yes' })).toEqual({})
    expect(parseCheckoutSearch({ plan: 'enterprise', seats: 'lots' })).toEqual({})
    expect(parseCheckoutSearch({ seats: 2.5 })).toEqual({})
    expect(parseCheckoutSearch({ seats: '1001' })).toEqual({ seats: 1001 })
  })
})

describe('checkoutSummary', () => {
  it('prices seats per interval and shows a monthly equivalent for annual', () => {
    expect(checkoutSummary(pro, 'annual', 3)).toEqual({
      unitCents: 59000,
      quantity: 3,
      totalCents: 177000,
      monthlyEquivalentCents: 14750,
      interval: 'year',
      billedPer: 'seat',
    })
    expect(checkoutSummary(pro, 'monthly', 3)).toMatchObject({
      unitCents: 5900,
      totalCents: 17700,
      monthlyEquivalentCents: 17700,
      interval: 'month',
    })
  })

  it('ignores the seat count for workspace-priced plans', () => {
    expect(checkoutSummary({ ...pro, billedPer: 'workspace' }, 'monthly', 12)).toMatchObject({
      quantity: 1,
      totalCents: 5900,
    })
  })
})

describe('annualSavingsPercent', () => {
  it('rounds the saving of yearly over twelve monthly payments', () => {
    expect(annualSavingsPercent(pro)).toBe(17)
    expect(annualSavingsPercent({ priceMonthlyCents: 1000, priceYearlyCents: 12000 })).toBeNull()
    expect(annualSavingsPercent({ priceMonthlyCents: 0, priceYearlyCents: 0 })).toBeNull()
  })
})

describe('annualSavingsLabel', () => {
  it('quotes the yearly dollar saving and prefers a catalogue amount', () => {
    expect(annualSavingsCents(pro)).toBe(11800)
    expect(annualSavingsLabel(pro)).toBe('Save $118/yr')
    expect(annualSavingsLabel({ ...pro, annualSavingsCents: 9600 })).toBe('Save $96/yr')
    expect(annualSavingsLabel({ priceMonthlyCents: 1000, priceYearlyCents: 12000 })).toBeNull()
    expect(annualSavingsLabel(null)).toBeNull()
  })
})
