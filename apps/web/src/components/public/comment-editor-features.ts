import type { EditorFeatures } from '@/components/ui/rich-text-editor'

/**
 * Same TipTap feature set as the post composer (admin / widget). Image insert
 * affordances still stay hidden until the composer also passes `onImageUpload`.
 */
export const COMMENT_EDITOR_FEATURES: EditorFeatures = {
  headings: true,
  codeBlocks: true,
  taskLists: true,
  blockquotes: true,
  dividers: true,
  images: true,
  tables: true,
  embeds: true,
  quackbackEmbeds: true,
  bubbleMenu: true,
  slashMenu: true,
  emojiPicker: true,
}
