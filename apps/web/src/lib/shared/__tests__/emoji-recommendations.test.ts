// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import {
  MAX_RECENT_EMOJIS,
  POPULAR_EMOJI_SHORTCODES,
  readRecentEmojis,
  recommendEmojiItems,
  recordRecentEmoji,
  type RankableEmoji,
} from '../emoji-recommendations'

installInMemoryLocalStorage()

const catalog: RankableEmoji[] = [
  { name: 'smile', emoji: '😄', shortcodes: ['smile'], tags: ['happy'] },
  { name: 'tada', emoji: '🎉', shortcodes: ['tada'], tags: ['party'] },
  {
    name: 'crossed_fingers',
    emoji: '🤞',
    shortcodes: ['fingers_crossed'],
    tags: ['finger', 'luck'],
  },
  {
    name: 'raised_hand_with_fingers_splayed',
    emoji: '🖐️',
    shortcodes: ['raised_hand_with_fingers_splayed'],
    tags: ['finger', 'hand'],
  },
  { name: 'fire', emoji: '🔥', shortcodes: ['fire'], tags: ['hot'] },
  { name: 'thumbsup', emoji: '👍', shortcodes: ['thumbsup', '+1'], tags: ['yes'] },
]

const lookup = (shortcode: string) =>
  catalog.find((e) => e.name === shortcode || e.shortcodes.includes(shortcode))

describe('recordRecentEmoji / readRecentEmojis', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns [] when nothing has been recorded', () => {
    expect(readRecentEmojis()).toEqual([])
  })

  it('moves the latest glyph to the front and dedupes', () => {
    recordRecentEmoji('🎉')
    recordRecentEmoji('🤞')
    recordRecentEmoji('🎉')
    expect(readRecentEmojis()).toEqual(['🎉', '🤞'])
  })

  it('caps recents at MAX_RECENT_EMOJIS', () => {
    for (let i = 0; i < MAX_RECENT_EMOJIS + 4; i++) {
      recordRecentEmoji(String.fromCodePoint(0x1f600 + i))
    }
    expect(readRecentEmojis()).toHaveLength(MAX_RECENT_EMOJIS)
  })

  it('ignores blank glyphs and corrupt storage', () => {
    recordRecentEmoji('   ')
    expect(readRecentEmojis()).toEqual([])
    window.localStorage.setItem('quackback:emoji-recent', '{not json')
    expect(readRecentEmojis()).toEqual([])
  })
})

describe('recommendEmojiItems', () => {
  const popular = ['smile', 'tada', 'thumbsup', 'fire', 'crossed_fingers'] as const

  it('on a bare query, lists recents then popular defaults', () => {
    const items = recommendEmojiItems('', {
      recents: ['🤞', '🔥'],
      popularShortcodes: popular,
      lookup,
      catalog,
      max: 12,
    })
    expect(items.map((i) => i.emoji)).toEqual(['🤞', '🔥', '😄', '🎉', '👍'])
  })

  it('boosts a matching recent above other substring hits', () => {
    const items = recommendEmojiItems('finger', {
      recents: ['🤞'],
      popularShortcodes: popular,
      lookup,
      catalog,
      max: 12,
    })
    expect(items[0]?.emoji).toBe('🤞')
    expect(items.some((i) => i.name === 'raised_hand_with_fingers_splayed')).toBe(true)
  })

  it('ranks an exact shortcode/name match first', () => {
    const items = recommendEmojiItems('fingers_crossed', {
      recents: ['🔥'],
      popularShortcodes: popular,
      lookup,
      catalog,
      max: 12,
    })
    expect(items[0]?.name).toBe('crossed_fingers')
  })

  it('includes crossed_fingers in the popular shortcode list', () => {
    expect(POPULAR_EMOJI_SHORTCODES).toContain('crossed_fingers')
  })
})
