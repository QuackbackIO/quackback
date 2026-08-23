import { describe, expect, it } from 'vitest'
import { composeAiUsage } from '../projection-overview'

describe('composeAiUsage', () => {
  it('converts tokens at the catalogue blended rate and derives extra from the cap', () => {
    // $5 / 1M tokens, $30 included = 6M tokens. Cap 8M → $10 extra credit.
    expect(
      composeAiUsage({
        usedTokens: 5_040_000,
        tokenCap: 8_000_000,
        includedCents: 3000,
        blendedCentsPerMTok: 500,
      })
    ).toEqual({
      includedCents: 3000,
      usedCents: 2520,
      extraCents: 1000,
    })
  })

  it('does not invent extra credit when the cap is the included allowance', () => {
    expect(
      composeAiUsage({
        usedTokens: 0,
        tokenCap: 6_000_000,
        includedCents: 3000,
        blendedCentsPerMTok: 500,
      })
    ).toEqual({ includedCents: 3000, usedCents: 0, extraCents: 0 })
  })
})
