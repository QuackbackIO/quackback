/**
 * Tiny TipTap → plain-text extractor used for `tickets.description_text` and
 * `ticket_threads.body_text`. Walks the JSON tree, concatenates `text` nodes,
 * and inserts blank lines between block-level nodes so previews read cleanly.
 *
 * Intentionally lightweight: the canonical body is the JSON; the text mirror
 * is for search, snippets, and email fallbacks.
 */
import type { TiptapContent } from '@/lib/server/db'

interface NodeLike {
  type?: string
  text?: string
  content?: NodeLike[]
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'listItem',
  'horizontalRule',
])

export function tiptapToPlainText(doc: TiptapContent | null | undefined): string {
  if (!doc) return ''
  const out: string[] = []
  walk(doc as NodeLike, out)
  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function walk(node: NodeLike, out: string[]): void {
  if (!node) return
  if (typeof node.text === 'string') {
    out.push(node.text)
    return
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, out)
  }
  if (node.type && BLOCK_TYPES.has(node.type)) {
    out.push('\n\n')
  }
}
