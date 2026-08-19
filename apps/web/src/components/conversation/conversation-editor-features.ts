import type { EditorFeatures } from '@/components/ui/rich-text-editor'

/**
 * EditorFeatures presets for conversation composers (agent replies, internal
 * notes, and visitor-facing messengers). Richer than the comment preset — code
 * blocks, images, blockquotes, and Quackback embeds are all on — but still
 * chat-shaped: headings, tables, task lists, and dividers stay off, and Enter
 * inserts a line break (a consumer that wants Enter-to-send passes onSubmit to
 * RichTextEditor, which overrides enterAsHardBreak).
 */

/** Agent reply composer. */
export const CONVERSATION_EDITOR_FEATURES: EditorFeatures = {
  headings: false,
  tables: false,
  taskLists: false,
  dividers: false,
  codeBlocks: true,
  images: true,
  blockquotes: true,
  embeds: true,
  quackbackEmbeds: true,
  emojiPicker: true,
  slashMenu: true,
  bubbleMenu: true,
  enterAsHardBreak: true,
  mentions: true,
}

/**
 * Internal note composer. Identical to the agent reply preset today, kept as a
 * separate constant so notes can diverge later (e.g. team-only mentions or a
 * different embed policy) without touching the reply composer.
 */
export const CONVERSATION_NOTE_FEATURES: EditorFeatures = {
  headings: false,
  tables: false,
  taskLists: false,
  dividers: false,
  codeBlocks: true,
  images: true,
  blockquotes: true,
  embeds: true,
  quackbackEmbeds: true,
  emojiPicker: true,
  slashMenu: true,
  bubbleMenu: true,
  enterAsHardBreak: true,
  mentions: true,
}

/**
 * Visitor-facing messenger composer. Same as the agent reply preset but with
 * mentions off — a visitor has nobody on the team to `@`-mention.
 */
export const VISITOR_CONVERSATION_FEATURES: EditorFeatures = {
  headings: false,
  tables: false,
  taskLists: false,
  dividers: false,
  codeBlocks: true,
  images: true,
  blockquotes: true,
  embeds: true,
  quackbackEmbeds: true,
  emojiPicker: true,
  slashMenu: true,
  bubbleMenu: true,
  enterAsHardBreak: true,
  mentions: false,
}
