/**
 * Extract previewable external URLs from a chat message.
 *
 * Collects URLs from: link marks in a TipTap doc AND a regex over the plain
 * text. Excludes internal Quackback URLs (handled by quackbackEmbed). Dedupes
 * and caps at 3.
 *
 * Pure function — no I/O, never throws.
 */

import type { TiptapContent } from '@/lib/shared/db-types'
import { parseEmbedUrl } from '@/lib/shared/embeds/parse-embed-url'

/** Broad http(s) URL regex for plain-text scanning. */
const HTTP_URL_RE = /https?:\/\/[^\s<>"']+/gi

function isPreviewable(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (parseEmbedUrl(url) !== null) return false
    return true
  } catch {
    return false
  }
}

/** Walk TipTap content nodes and collect link-mark hrefs. */
function collectLinkMarks(node: TiptapContent | null | undefined): string[] {
  if (!node || typeof node !== 'object') return []
  const out: string[] = []
  const stack: TiptapContent[] = [node]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (Array.isArray(n.marks)) {
      for (const mark of n.marks) {
        if (mark.type === 'link' && typeof mark.attrs?.href === 'string') {
          out.push(mark.attrs.href as string)
        }
      }
    }
    if (Array.isArray(n.content)) {
      for (let i = n.content.length - 1; i >= 0; i--) {
        stack.push(n.content[i])
      }
    }
  }
  return out
}

export function extractPreviewableUrls(
  content: string,
  contentJson?: TiptapContent | null
): string[] {
  try {
    const candidates: string[] = []

    // 1. Link marks from TipTap doc
    if (contentJson) {
      candidates.push(...collectLinkMarks(contentJson))
    }

    // 2. Plain text regex
    if (typeof content === 'string') {
      const textMatches = content.match(HTTP_URL_RE) ?? []
      candidates.push(...textMatches)
    }

    // Filter, dedupe, cap
    const seen = new Set<string>()
    const result: string[] = []
    for (const url of candidates) {
      if (seen.has(url)) continue
      seen.add(url)
      if (!isPreviewable(url)) continue
      result.push(url)
      if (result.length === 3) break
    }
    return result
  } catch {
    return []
  }
}
