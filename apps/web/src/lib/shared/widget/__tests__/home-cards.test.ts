/**
 * Per-card audience visibility (visitor-vs-user content): a card targets
 * everyone, signed-out visitors, or identified users.
 */
import { describe, it, expect } from 'vitest'
import { cardVisibleToVisitor } from '../home-cards'

describe('cardVisibleToVisitor', () => {
  it('shows unset/everyone to both anonymous and identified', () => {
    for (const audience of [undefined, 'everyone'] as const) {
      expect(cardVisibleToVisitor(audience, false)).toBe(true)
      expect(cardVisibleToVisitor(audience, true)).toBe(true)
    }
  })

  it('shows anonymous cards only to signed-out visitors', () => {
    expect(cardVisibleToVisitor('anonymous', false)).toBe(true)
    expect(cardVisibleToVisitor('anonymous', true)).toBe(false)
  })

  it('shows identified cards only to signed-in visitors', () => {
    expect(cardVisibleToVisitor('identified', true)).toBe(true)
    expect(cardVisibleToVisitor('identified', false)).toBe(false)
  })
})
