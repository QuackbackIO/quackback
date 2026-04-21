/**
 * Pure utility functions for help center article pages.
 * Extracted for testability — no React dependencies.
 */

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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface TipTapNode {
  type?: string
  text?: string
  content?: TipTapNode[]
  attrs?: Record<string, unknown>
}

function extractTextFromNode(node: TipTapNode | null | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join('')
  }
  return ''
}

export function extractHeadings(contentJson: { type?: string; content?: TipTapNode[] } | null | undefined): TocHeading[] {
  if (!contentJson || !Array.isArray(contentJson.content)) return []

  const headings: TocHeading[] = []

  for (const node of contentJson.content) {
    if (node.type !== 'heading') continue
    const level = node.attrs?.level
    if (level !== 2 && level !== 3) continue

    const text = extractTextFromNode(node).trim()
    if (!text) continue

    headings.push({
      id: slugify(text),
      text,
      level,
    })
  }

  return headings
}

// =============================================================================
// computePrevNext — finds previous/next articles given a flat list + current slug
// =============================================================================

interface ArticleLike {
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
