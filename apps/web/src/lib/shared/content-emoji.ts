/**
 * Bundled-emoji lookup, isolated from the read-only content serializer.
 *
 * `@tiptap/extension-emoji` ships a ~700 KB shortcode→character dataset. Read-only
 * portal surfaces (post/comment/changelog/help-center renderers) reach
 * `@/lib/shared/content-html`, so importing the dataset there would drag it into
 * every reader's eager chunk. This module keeps the dataset out of that path:
 *
 *  - The EDITOR imports `lookupEmoji`/`defaultEmojis` here for its `:` picker (the
 *    editor chunk is already lazy-loaded on compose surfaces, so paying the
 *    dataset cost there is fine).
 *  - The SERVER markdown derivation imports `lookupEmoji` here directly (server
 *    bundles never ship to the client).
 *  - The read-only client renderer (`RichTextContent`) DYNAMICALLY imports this
 *    module, and only for the rare legacy emoji node that stored just a `name`
 *    shortcode without the Unicode char — so the dataset loads on demand instead
 *    of statically.
 *
 * The dataset is pure data (no browser globals), so this is safe server-side.
 */
import { emojis as defaultEmojis, type EmojiItem } from '@tiptap/extension-emoji'

export { defaultEmojis }
export type { EmojiItem }

/**
 * Resolve a bundled emoji by shortcode (e.g. `smile`). Shared with the editor's
 * `:`-picker, the server markdown serializer, and the read-only renderer's
 * on-demand legacy fallback.
 */
export function lookupEmoji(shortcode: string): EmojiItem | undefined {
  return defaultEmojis.find((e) => e.emoji && e.shortcodes.includes(shortcode))
}
