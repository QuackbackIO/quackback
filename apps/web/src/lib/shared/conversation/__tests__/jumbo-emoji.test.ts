import { describe, it, expect } from 'vitest'
import { isEmojiOnly, isJumboEmojiMessage } from '../jumbo-emoji'

describe('isEmojiOnly', () => {
  it('is true for a lone emoji and a few emoji', () => {
    expect(isEmojiOnly('😀')).toBe(true)
    expect(isEmojiOnly('🎉🎉🎉')).toBe(true)
    expect(isEmojiOnly('  👍  ')).toBe(true)
  })

  it('treats ZWJ sequences and skin-tone modifiers as one grapheme', () => {
    expect(isEmojiOnly('👍🏽')).toBe(true)
    expect(isEmojiOnly('👨‍👩‍👧‍👦')).toBe(true)
  })

  it('is false when any non-emoji text is present', () => {
    expect(isEmojiOnly('hi 😀')).toBe(false)
    expect(isEmojiOnly('😀 nice')).toBe(false)
    expect(isEmojiOnly('lgtm')).toBe(false)
  })

  it('is false for empty/whitespace and beyond the cap', () => {
    expect(isEmojiOnly('')).toBe(false)
    expect(isEmojiOnly('   ')).toBe(false)
    expect(isEmojiOnly('😀😀😀😀😀😀😀')).toBe(false)
  })
})

describe('isJumboEmojiMessage', () => {
  const doc = (...nodes: unknown[]) => ({ type: 'doc', content: nodes }) as never

  it('is true for an emoji-only message, with or without a plain text doc', () => {
    expect(isJumboEmojiMessage('🎉')).toBe(true)
    expect(
      isJumboEmojiMessage('🎉', doc({ type: 'paragraph', content: [{ type: 'text', text: '🎉' }] }))
    ).toBe(true)
  })

  it('is false when the doc carries an image or embed (would be dropped)', () => {
    expect(isJumboEmojiMessage('🎉', doc({ type: 'chatImage', attrs: { src: '/x' } }))).toBe(false)
    expect(
      isJumboEmojiMessage('🎉', doc({ type: 'quackbackEmbed', attrs: { kind: 'post', id: 'x' } }))
    ).toBe(false)
  })
})
