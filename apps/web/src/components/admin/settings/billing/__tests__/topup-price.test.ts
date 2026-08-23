import { describe, expect, it } from 'vitest'
import { hasTopUpPackPrice } from '../topup-price'

describe('hasTopUpPackPrice', () => {
  it('accepts a finite catalogue pack price', () => {
    expect(hasTopUpPackPrice(1000)).toBe(true)
    expect(hasTopUpPackPrice(0)).toBe(true)
  })

  it('rejects missing or non-finite values', () => {
    expect(hasTopUpPackPrice(undefined)).toBe(false)
    expect(hasTopUpPackPrice(null)).toBe(false)
    expect(hasTopUpPackPrice(Number.NaN)).toBe(false)
    expect(hasTopUpPackPrice(Number.POSITIVE_INFINITY)).toBe(false)
    expect(hasTopUpPackPrice('1000')).toBe(false)
  })
})
