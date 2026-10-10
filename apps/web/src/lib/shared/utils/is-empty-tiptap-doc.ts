import type { TiptapContent } from '@/lib/shared/db-types'

/**
 * Returns true when a TipTap document carries no visible content — either
 * because it's undefined, has no children, or its only children are empty
 * containers / whitespace-only text. Used to decide whether to render
 * rich-text-driven UI (e.g. the portal welcome card body) and whether a
 * changelog body is present.
 *
 * Non-text leaf nodes such as images, horizontal rules, hard breaks and
 * embeds count as content, even when they carry no text. List and table
 * shells recurse: an empty bullet list is empty; a list with text is not.
 */
export function isEmptyTiptapDoc(doc: TiptapContent | undefined): boolean {
  if (!doc) return true
  const content = doc.content
  if (!content || content.length === 0) return true
  return content.every((child) => isEmptyNode(child, 0))
}

// Stack-safety guard for pathological inputs reaching this helper before
// server-side sanitization (e.g. cached SSR payloads, third-party clients).
const MAX_DEPTH = 50

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'blockquote'])
const CONTAINERS = new Set([
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
])

function isEmptyNode(node: TiptapContent, depth: number): boolean {
  if (depth > MAX_DEPTH) return false
  if (node.type === 'text') {
    return (node.text ?? '').trim().length === 0
  }
  // Text-bearing blocks and list/table shells: empty if every descendant is.
  if (node.type && (TEXT_BLOCKS.has(node.type) || CONTAINERS.has(node.type))) {
    const children = node.content
    if (!children || children.length === 0) return true
    return children.every((child) => isEmptyNode(child, depth + 1))
  }
  // Visible leaves — image, horizontalRule, hardBreak, embed, etc.
  return false
}
