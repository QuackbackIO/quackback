/**
 * Pure utility functions for help center article pages.
 * Extracted for testability — no React dependencies.
 */

import { collectHeadings, createHeadingIds, plainText } from '@/lib/shared/heading-ids'

// =============================================================================
// Types
// =============================================================================

export interface TocHeading {
  id: string
  text: string
  level: number
}

// =============================================================================
// extractHeadings — walks TipTap JSON and pulls out H2/H3 headings
// =============================================================================

interface TipTapNode {
  type?: string
  text?: string
  content?: TipTapNode[]
  attrs?: Record<string, unknown>
}

export function extractHeadings(
  contentJson: { type?: string; content?: TipTapNode[] } | null | undefined
): TocHeading[] {
  if (!contentJson || !Array.isArray(contentJson.content)) return []

  // Ids come from every heading in document order, as the article HTML assigns
  // them, so repeated text gets the same suffix in both places. Only H2 and H3
  // are listed.
  const headings = collectHeadings(contentJson)
  const ids = createHeadingIds(headings)
  const listed: TocHeading[] = []
  for (const node of headings) {
    const id = ids.get(node)
    const level = node.attrs?.level
    if (id && (level === 2 || level === 3)) {
      listed.push({ id, text: plainText(node).trim(), level })
    }
  }
  return listed
}

// =============================================================================
// computePrevNext — finds previous/next articles given a flat list + current slug
// =============================================================================

interface ArticleLike {
  id: string
  urlId: number
  slug: string
  title: string
}

export function computePrevNext<T extends ArticleLike>(
  articles: T[],
  currentSlug: string
): { prev: T | null; next: T | null } {
  const index = articles.findIndex((a) => a.slug === currentSlug)
  if (index === -1) return { prev: null, next: null }

  return {
    prev: index > 0 ? articles[index - 1] : null,
    next: index < articles.length - 1 ? articles[index + 1] : null,
  }
}
