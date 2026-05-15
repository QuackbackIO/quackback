import type { TiptapContent } from '@/lib/shared/db-types'

/**
 * Returns true when a TipTap document carries no visible content — either
 * because it's undefined, has no children, or its only children are an
 * empty paragraph or whitespace-only text. Used to decide whether to
 * render rich-text-driven UI (e.g. the portal welcome card body).
 *
 * Non-text leaf nodes such as images, horizontal rules, hard breaks and
 * embeds count as content, even when they carry no text.
 */
export function isEmptyTiptapDoc(doc: TiptapContent | undefined): boolean {
  if (!doc) return true
  const content = doc.content
  if (!content || content.length === 0) return true
  return content.every(isEmptyNode)
}

function isEmptyNode(node: TiptapContent): boolean {
  // Text-bearing block: empty if all text descendants are whitespace.
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'blockquote') {
    const children = node.content
    if (!children || children.length === 0) return true
    return children.every(isEmptyNode)
  }
  if (node.type === 'text') {
    return (node.text ?? '').trim().length === 0
  }
  // Any other node type — image, horizontalRule, list, table, embed, etc.
  // — counts as content even with no text.
  return false
}
