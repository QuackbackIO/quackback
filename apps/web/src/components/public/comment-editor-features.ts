import type { EditorFeatures } from '@/components/ui/rich-text-editor'

/**
 * EditorFeatures preset for comment composers (portal + widget + admin
 * inline replies). Matches the slim COMMENT_EXTENSIONS set on the server
 * side — headings, blockquotes, task lists, bold/italic/strike/inline-code,
 * underline, links, lists — and intentionally excludes images, tables,
 * code blocks, embeds, and dividers. Bubble + slash menus stay on so power
 * users still get fast formatting affordances.
 */
export const COMMENT_EDITOR_FEATURES: EditorFeatures = {
  headings: true,
  taskLists: true,
  blockquotes: true,
  bubbleMenu: true,
  slashMenu: true,
  emojiPicker: true,
  // Chat-style behaviour: Enter is a single line break; Shift+Enter
  // splits the paragraph for the rare case it's wanted.
  enterAsHardBreak: true,
  images: false,
  tables: false,
  codeBlocks: false,
  dividers: false,
  embeds: false,
  // Pasting a Quackback post/changelog link becomes a live embed card.
  quackbackEmbeds: true,
}
