import type { JSONContent } from '@tiptap/core'
import type { PrincipalId } from '@quackback/ids'

/**
 * Walk a TipTap document and collect the principalIds of every mention node.
 * Returns a Set so repeated mentions of the same principal collapse to one entry.
 */
export function extractMentions(content: JSONContent | null | undefined): Set<PrincipalId> {
  const acc = new Set<PrincipalId>()
  if (!content) return acc
  walk(content, acc)
  return acc
}

function walk(node: JSONContent, acc: Set<PrincipalId>): void {
  if (node.type === 'mention') {
    const id = node.attrs?.id
    if (typeof id === 'string' && id.length > 0) {
      acc.add(id as PrincipalId)
    }
    return
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, acc)
  }
}

/**
 * Walk the doc and produce a map from mentioned principalId → text excerpt of the
 * containing paragraph/block. Used in mention emails so the recipient sees context.
 * If the same principal is mentioned multiple times, the first occurrence wins.
 */
export function extractMentionExcerpts(
  content: JSONContent | null | undefined,
  maxLen = 200
): Map<PrincipalId, string> {
  const out = new Map<PrincipalId, string>()
  if (!content?.content) return out
  for (const block of content.content) {
    const blockText = collectText(block).trim().slice(0, maxLen)
    const ids = new Set<PrincipalId>()
    walk(block, ids)
    for (const id of ids) {
      if (!out.has(id)) out.set(id, blockText)
    }
  }
  return out
}

function collectText(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(collectText).join('')
}
