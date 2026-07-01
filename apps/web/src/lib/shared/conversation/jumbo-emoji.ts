import type { TiptapContent } from '@/lib/shared/db-types'

/** Up to this many emoji (and nothing else) still render large; beyond it the
 *  message reads as content, not a reaction, so it stays normal size. */
const MAX_JUMBO_EMOJI = 6

/** Rich nodes that mean the message carries more than emoji, so it must NOT be
 *  collapsed to a large plain-text render (we'd drop the image/embed). */
const MEDIA_NODES = new Set(['chatImage', 'quackbackEmbed', 'image', 'resizableImage', 'youtube'])

interface JsonNode {
  type?: string
  content?: JsonNode[]
}

function hasMediaNode(node: JsonNode | null | undefined): boolean {
  if (!node) return false
  if (node.type && MEDIA_NODES.has(node.type)) return true
  return Array.isArray(node.content) && node.content.some(hasMediaNode)
}

/**
 * True when `text` is only emoji (1..MAX graphemes, ignoring whitespace). Uses
 * Intl.Segmenter so ZWJ sequences (👨‍👩‍👧‍👦) and skin-tone modifiers (👍🏽) count as a
 * single grapheme rather than several.
 */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  let count = 0
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const { segment } of segmenter.segment(trimmed)) {
    if (/^\s+$/u.test(segment)) continue
    if (!/\p{Extended_Pictographic}/u.test(segment)) return false
    if (++count > MAX_JUMBO_EMOJI) return false
  }
  return count > 0
}

/**
 * A conversation message that is only emoji (and carries no image/embed) renders large,
 * the way Slack/iMessage enlarge a lone-emoji message. Drives the bubble render
 * on every surface (admin inbox + widget).
 */
export function isJumboEmojiMessage(content: string, contentJson?: TiptapContent | null): boolean {
  if (hasMediaNode(contentJson as JsonNode | null | undefined)) return false
  return isEmojiOnly(content)
}

/** Tailwind classes for the enlarged lone-emoji render. */
export const JUMBO_EMOJI_CLASS = 'mt-0.5 text-4xl leading-tight'
