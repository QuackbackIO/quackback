import { describe, expect, it } from 'vitest'
import { qualifiesAsFirstWin } from '../activation-wins'

describe('first-win predicates', () => {
  it.each([
    ['customer_support', { customerOriginatedConversation: true }],
    ['help_center', { publishedArticle: true }],
    ['product_feedback', { externalPost: true }],
    ['product_feedback', { externalVote: true }],
    ['internal', { onInternalBoard: true }],
  ] as const)('accepts the first real %s outcome', (outcome, facts) => {
    expect(qualifiesAsFirstWin(outcome, facts)).toBe(true)
  })

  it.each([
    { externalPost: true, onboardingGenerated: true },
    { externalVote: true, testRecord: true },
    { publishedArticle: true, deleted: true },
    { onInternalBoard: true, onboardingGenerated: true },
    { customerOriginatedConversation: true, testRecord: true },
  ])('rejects generated, test, or deleted evidence: %o', (facts) => {
    expect(qualifiesAsFirstWin('product_feedback', facts)).toBe(false)
    expect(qualifiesAsFirstWin('customer_support', facts)).toBe(false)
    expect(qualifiesAsFirstWin('help_center', facts)).toBe(false)
    expect(qualifiesAsFirstWin('internal', facts)).toBe(false)
  })

  it('does not confuse setup with a first win', () => {
    expect(qualifiesAsFirstWin('customer_support', {})).toBe(false)
    expect(qualifiesAsFirstWin('help_center', {})).toBe(false)
    expect(qualifiesAsFirstWin('product_feedback', {})).toBe(false)
    expect(qualifiesAsFirstWin('internal', {})).toBe(false)
  })
})
