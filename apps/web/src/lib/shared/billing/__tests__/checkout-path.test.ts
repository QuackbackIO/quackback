import { describe, expect, it } from 'vitest'
import {
  annualSavingsCents,
  annualSavingsLabel,
  annualSavingsPercent,
  checkoutPath,
  checkoutSummary,
  parseCheckoutSearch,
  parsePaidPlanId,
} from '../checkout-path'

const pro = { priceMonthlyCents: 3700, priceYearlyCents: 34800 }

describe('checkoutPath', () => {
  it('encodes only what was given', () => {
    expect(checkoutPath()).toBe('/admin/settings/billing/checkout')
    expect(checkoutPath({ plan: 'business' })).toBe(
      '/admin/settings/billing/checkout?plan=business'
    )
    expect(parsePaidPlanId('pro')).toBe('pro')
    expect(parsePaidPlanId('growth')).toBe('pro')
    expect(parsePaidPlanId('scale')).toBe('enterprise')
    expect(parsePaidPlanId('business')).toBe('business')
    expect(parsePaidPlanId('enterprise')).toBe('enterprise')
    expect(checkoutPath({ plan: parsePaidPlanId('pro') ?? 'pro' })).toBe(
      '/admin/settings/billing/checkout?plan=pro'
    )
    expect(checkoutPath({ plan: 'business', period: 'monthly' })).toBe(
      '/admin/settings/billing/checkout?plan=business&period=monthly'
    )
    expect(checkoutPath({ plan: 'business', branding: true })).toBe(
      '/admin/settings/billing/checkout?plan=business&branding=true'
    )
    expect(checkoutPath({ plan: 'business', branding: false })).toBe(
      '/admin/settings/billing/checkout?plan=business'
    )
  })
})

describe('parseCheckoutSearch', () => {
  it('keeps valid values and drops the rest', () => {
    expect(parseCheckoutSearch({ plan: 'scale', period: 'annual', branding: 'true' })).toEqual({
      plan: 'enterprise',
      period: 'annual',
      branding: true,
    })
    expect(parseCheckoutSearch({ plan: 'free', period: 'weekly' })).toEqual({})
    expect(parseCheckoutSearch({ branding: 'false' })).toEqual({})
    expect(parseCheckoutSearch({ branding: 'yes' })).toEqual({})
    expect(parseCheckoutSearch({ plan: 'platinum' })).toEqual({})
    expect(parseCheckoutSearch({ plan: 'enterprise' })).toEqual({ plan: 'enterprise' })
    expect(parseCheckoutSearch({ plan: 'pro' })).toEqual({ plan: 'pro' })
    expect(parseCheckoutSearch({ plan: 'growth' })).toEqual({ plan: 'pro' })
    expect(parseCheckoutSearch({ plan: 'business' })).toEqual({ plan: 'business' })
    expect(parseCheckoutSearch({ seats: '4' })).toEqual({})
  })
})

describe('checkoutSummary', () => {
  it('prices the workspace per interval and shows a monthly equivalent for annual', () => {
    expect(checkoutSummary(pro, 'annual')).toEqual({
      unitCents: 34800,
      totalCents: 34800,
      monthlyEquivalentCents: 2900,
      interval: 'year',
    })
    expect(checkoutSummary(pro, 'monthly')).toMatchObject({
      unitCents: 3700,
      totalCents: 3700,
      monthlyEquivalentCents: 3700,
      interval: 'month',
    })
  })
})

describe('annualSavingsPercent', () => {
  it('rounds the saving of yearly over twelve monthly payments', () => {
    expect(annualSavingsPercent(pro)).toBe(22)
    expect(annualSavingsPercent({ priceMonthlyCents: 1000, priceYearlyCents: 12000 })).toBeNull()
    expect(annualSavingsPercent({ priceMonthlyCents: 0, priceYearlyCents: 0 })).toBeNull()
  })
})

describe('annualSavingsLabel', () => {
  it('quotes the yearly dollar saving and prefers a catalogue amount', () => {
    expect(annualSavingsCents(pro)).toBe(9600)
    expect(annualSavingsLabel(pro)).toBe('Save $96/yr')
    expect(annualSavingsLabel({ ...pro, annualSavingsCents: 19200 })).toBe('Save $192/yr')
    expect(annualSavingsLabel({ priceMonthlyCents: 1000, priceYearlyCents: 12000 })).toBeNull()
    expect(annualSavingsLabel(null)).toBeNull()
  })
})
