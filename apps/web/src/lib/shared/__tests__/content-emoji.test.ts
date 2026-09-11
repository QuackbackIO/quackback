import { describe, expect, it } from 'vitest'
import { lookupEmoji } from '../content-emoji'

describe('lookupEmoji', () => {
  it('resolves a shortcode that is also the canonical name (tada)', () => {
    expect(lookupEmoji('tada')?.emoji).toBe('🎉')
  })

  it('resolves crossed_fingers by canonical name (not in shortcodes[])', () => {
    // TipTap stores attrs.name = "crossed_fingers"; the only shortcode is
    // "fingers_crossed". Looking up by name must still return the glyph.
    const byName = lookupEmoji('crossed_fingers')
    expect(byName?.emoji).toBe('🤞')
    expect(byName?.name).toBe('crossed_fingers')
  })

  it('resolves the Slack-style fingers_crossed shortcode to the same glyph', () => {
    const byShortcode = lookupEmoji('fingers_crossed')
    expect(byShortcode?.emoji).toBe('🤞')
    expect(byShortcode?.name).toBe('crossed_fingers')
  })

  it('returns undefined for an unknown shortcode', () => {
    expect(lookupEmoji('not_a_real_emoji_zzz')).toBeUndefined()
  })
})
