/**
 * Recent + popular emoji ranking, shared by the `:` typeahead and the smile-button
 * grid. Slack/WhatsApp put recently used glyphs first, then a stable popular set.
 *
 * Recents are stored as Unicode chars (not shortcodes) so the smile-button picker
 * can stay dataset-free. The `:` picker maps those chars back onto TipTap items.
 *
 * This module is browser-storage only on the write path; reads tolerate SSR by
 * returning []. It never imports `@tiptap/extension-emoji`.
 */

export const EMOJI_RECENT_STORAGE_KEY = 'quackback:emoji-recent'
export const MAX_RECENT_EMOJIS = 8
export const MAX_EMOJI_SUGGESTIONS = 12

/** Curated popular shortcodes for the bare-`:` typeahead (Slack-style defaults). */
export const POPULAR_EMOJI_SHORTCODES = [
  'smile',
  'joy',
  'heart_eyes',
  'thinking',
  'rolling_on_the_floor_laughing',
  'face_with_tears_of_joy',
  'thumbsup',
  'thumbsdown',
  'heart',
  'fire',
  'tada',
  'rocket',
  'crossed_fingers',
] as const

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Most-recent-first Unicode chars. Invalid / empty / blocked storage yields []. */
export function readRecentEmojis(): string[] {
  let raw: string | null = null
  try {
    // getItem itself can throw under blocked storage (privacy-restricted
    // embedded widget) — not just the window.localStorage access above.
    raw = storage()?.getItem(EMOJI_RECENT_STORAGE_KEY) ?? null
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .slice(0, MAX_RECENT_EMOJIS)
  } catch {
    return []
  }
}

/** Move `emoji` to the front of recents (deduped, capped). */
export function recordRecentEmoji(emoji: string): void {
  const glyph = emoji.trim()
  if (!glyph) return
  const next = [glyph, ...readRecentEmojis().filter((item) => item !== glyph)].slice(
    0,
    MAX_RECENT_EMOJIS
  )
  try {
    storage()?.setItem(EMOJI_RECENT_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota / private mode — ranking just falls back to the popular set.
  }
}

export interface RankableEmoji {
  name: string
  emoji?: string
  shortcodes: string[]
  tags?: string[]
}

function itemMatches(item: RankableEmoji, query: string): boolean {
  if (item.name.toLowerCase().includes(query)) return true
  if (item.shortcodes.some((s) => s.toLowerCase().includes(query))) return true
  return item.tags?.some((t) => t.toLowerCase().includes(query)) ?? false
}

function matchRank(item: RankableEmoji, query: string, recentGlyphs: Set<string>): number {
  const name = item.name.toLowerCase()
  const shorts = item.shortcodes.map((s) => s.toLowerCase())
  if (name === query || shorts.includes(query)) return 0
  if (item.emoji && recentGlyphs.has(item.emoji)) return 1
  if (name.startsWith(query) || shorts.some((s) => s.startsWith(query))) return 2
  return 3
}

/**
 * Rank TipTap emoji items for the `:` typeahead.
 *
 * Empty query: recents (resolved via `lookupByGlyph`) then popular shortcodes.
 * Typed query: exact name/shortcode, then matching recents, then prefix, then
 * substring/tag hits — capped at `max`.
 */
export function recommendEmojiItems<T extends RankableEmoji>(
  query: string,
  opts: {
    recents: readonly string[]
    popularShortcodes: readonly string[]
    lookup: (shortcode: string) => T | undefined
    lookupByGlyph?: (glyph: string) => T | undefined
    catalog: readonly T[]
    max: number
  }
): T[] {
  const { recents, popularShortcodes, lookup, catalog, max } = opts
  const lookupByGlyph =
    opts.lookupByGlyph ??
    ((glyph: string) => catalog.find((item) => item.emoji === glyph && !!item.emoji))

  const pushUnique = (out: T[], item: T | undefined) => {
    if (!item?.emoji) return
    if (out.some((existing) => existing.name === item.name)) return
    out.push(item)
  }

  const trimmed = query.trim().toLowerCase()
  if (!trimmed) {
    const out: T[] = []
    for (const glyph of recents) pushUnique(out, lookupByGlyph(glyph))
    for (const shortcode of popularShortcodes) pushUnique(out, lookup(shortcode))
    return out.slice(0, max)
  }

  const recentSet = new Set(recents)
  const matches = catalog.filter((item) => item.emoji && itemMatches(item, trimmed))
  matches.sort((a, b) => {
    const rank = matchRank(a, trimmed, recentSet) - matchRank(b, trimmed, recentSet)
    if (rank !== 0) return rank
    const aRecent = a.emoji ? recents.indexOf(a.emoji) : -1
    const bRecent = b.emoji ? recents.indexOf(b.emoji) : -1
    if (aRecent !== -1 || bRecent !== -1) {
      if (aRecent === -1) return 1
      if (bRecent === -1) return -1
      return aRecent - bRecent
    }
    return 0
  })
  return matches.slice(0, max)
}
