/**
 * Re-resolve mention.label against current principal.displayName so renamed
 * users show their up-to-date name in rendered post / comment HTML.
 *
 * One DB round-trip per document regardless of mention count. Missing
 * principals (deleted / disabled) are downgraded to plain text nodes so
 * they render as `@<storedLabel>` without the .mention chip styling or
 * the hover-card overlay's data attributes.
 */

import type { JSONContent } from '@tiptap/core'
import { db, principal, inArray } from '@/lib/server/db'
import { extractMentions } from './extract-mentions'

export async function hydrateMentions(content: JSONContent): Promise<JSONContent> {
  const ids = Array.from(extractMentions(content))
  if (ids.length === 0) return content

  const rows = await db
    .select({ id: principal.id, displayName: principal.displayName })
    .from(principal)
    .where(inArray(principal.id, ids))

  // Skip rows where displayName is null — treat them as deleted/unresolvable
  // so they fall through to the plain-text fallback below.
  const byId = new Map<string, string>()
  for (const r of rows) {
    if (typeof r.displayName === 'string' && r.displayName.length > 0) {
      byId.set(r.id as string, r.displayName)
    }
  }
  return walk(content, byId)
}

function walk(node: JSONContent, byId: Map<string, string>): JSONContent {
  if (node.type === 'mention') {
    const id = node.attrs?.id as string | undefined
    if (id && byId.has(id)) {
      return { ...node, attrs: { ...node.attrs, label: byId.get(id)! } }
    }
    // Deleted principal → plain text fallback (no chip, no hover card).
    const fallbackLabel = (node.attrs?.label as string | undefined) ?? ''
    return { type: 'text', text: `@${fallbackLabel}` }
  }
  if (Array.isArray(node.content)) {
    return { ...node, content: node.content.map((child) => walk(child, byId)) }
  }
  return node
}
