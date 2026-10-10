/** Emoji lookups for the editor picker and typed or pasted shortcuts. */
import { emojis as defaultEmojis, type EmojiItem } from '@tiptap/extension-emoji'

export { defaultEmojis }
export type { EmojiItem }

/**
 * Resolve a bundled emoji by canonical name or any shortcode (e.g. `smile`,
 * `crossed_fingers`, `fingers_crossed`) when processing typed shortcuts.
 */
export function lookupEmoji(shortcode: string): EmojiItem | undefined {
  return defaultEmojis.find(
    (e) => e.emoji && (e.name === shortcode || e.shortcodes.includes(shortcode))
  )
}

const withoutVariationSelectors = (value: string) => value.replace(/[︎️]/g, '')

/** Keyed lookups built on first use; each key keeps the first item the dataset lists for it. */
let byChar: Map<string, EmojiItem> | undefined
let byEmoticon: Map<string, EmojiItem> | undefined

function firstByKey(keysOf: (item: EmojiItem) => readonly string[]): Map<string, EmojiItem> {
  const map = new Map<string, EmojiItem>()
  for (const item of defaultEmojis) {
    if (!item.emoji) continue
    for (const key of keysOf(item)) if (!map.has(key)) map.set(key, item)
  }
  return map
}

/** The bundled emoji for a character sequence as typed or pasted, variation selectors aside. */
export function emojiForChar(char: string): EmojiItem | undefined {
  byChar ??= firstByKey((item) => [withoutVariationSelectors(item.emoji!)])
  return byChar.get(withoutVariationSelectors(char))
}

/** The bundled emoji an emoticon such as `:)` or `<3` stands for. */
export function emojiForEmoticon(emoticon: string): EmojiItem | undefined {
  byEmoticon ??= firstByKey((item) => item.emoticons ?? [])
  return byEmoticon.get(emoticon)
}
