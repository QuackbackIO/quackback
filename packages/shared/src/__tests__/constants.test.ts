import { describe, it, expect } from 'vitest'
import { REACTION_EMOJIS, type ReactionEmoji } from '../constants'

describe('REACTION_EMOJIS', () => {
  it('is an array', () => {
    expect(Array.isArray(REACTION_EMOJIS)).toBe(true)
  })

  it('has 6 items', () => {
    expect(REACTION_EMOJIS).toHaveLength(6)
  })

  it('contains expected emojis', () => {
    expect(REACTION_EMOJIS).toContain('👍')
    expect(REACTION_EMOJIS).toContain('❤️')
    expect(REACTION_EMOJIS).toContain('🎉')
    expect(REACTION_EMOJIS).toContain('😄')
    expect(REACTION_EMOJIS).toContain('🤔')
    expect(REACTION_EMOJIS).toContain('👀')
  })

  it('exports correct type', () => {
    // Type check - this will fail at compile time if the type is wrong
    const emoji: ReactionEmoji = '👍'
    expect(REACTION_EMOJIS).toContain(emoji)
  })
})
