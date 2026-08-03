import type { EditorFeatures } from '@/components/ui/rich-text-editor'

/**
 * Shared editor capabilities for ticket creation across portal/admin/widget.
 * Keeps the same core authoring experience everywhere while allowing image uploads.
 */
export const TICKET_CREATE_EDITOR_FEATURES: EditorFeatures = {
  headings: true,
  images: true,
  codeBlocks: true,
  bubbleMenu: true,
  slashMenu: true,
  taskLists: true,
  blockquotes: true,
  tables: false,
  dividers: true,
  embeds: false,
  quackbackEmbeds: true,
  emojiPicker: true,
}
