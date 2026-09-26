/**
 * Bundled-emoji lookup, isolated so only the code that needs the dataset loads it.
 *
 * `@tiptap/extension-emoji` ships a ~600 KB shortcode→character dataset. This
 * module is its only importer, and everything that runs in the browser imports
 * it dynamically:
 *
 *  - The EDITOR's emoji node (`components/ui/emoji-node`) loads it the first
 *    time an editor gains focus, opens the `:` picker, or shows an emoji node
 *    stored without its character.
 *  - The read-only renderer (`RichTextContent`) loads it only for such a
 *    legacy `name`-only emoji node.
 *  - The SERVER markdown derivation imports `lookupEmoji` directly (server
 *    bundles never ship to the client).
 *
 * The dataset is pure data (no browser globals), so this is safe server-side.
 */
import { emojis as defaultEmojis, type EmojiItem } from '@tiptap/extension-emoji'

export { defaultEmojis }
export type { EmojiItem }

/**
 * Resolve a bundled emoji by canonical name or any shortcode (e.g. `smile`,
 * `crossed_fingers`, `fingers_crossed`). Matches TipTap's `shortcodeToEmoji`
 * so a name-only node whose `name` is not itself a shortcode still resolves —
 * 284 of the bundled items are in that shape, including `crossed_fingers`.
 */
export function lookupEmoji(shortcode: string): EmojiItem | undefined {
  return defaultEmojis.find(
    (e) => e.emoji && (e.name === shortcode || e.shortcodes.includes(shortcode))
  )
}

const withoutVariationSelectors = (value: string) => value.replace(/[︎️]/g, '')

/** The bundled emoji for a character sequence as typed or pasted, variation selectors aside. */
export function emojiForChar(char: string): EmojiItem | undefined {
  const typed = withoutVariationSelectors(char)
  return defaultEmojis.find((e) => e.emoji && withoutVariationSelectors(e.emoji) === typed)
}

/** The bundled emoji an emoticon such as `:)` or `<3` stands for. */
export function emojiForEmoticon(emoticon: string): EmojiItem | undefined {
  return defaultEmojis.find((e) => e.emoji && e.emoticons?.includes(emoticon))
}
