/**
 * Pure utility functions for the help center UI.
 * Extracted for testability — no React dependencies.
 */

interface CategoryLike {
  parentId?: string | null
}

/**
 * Filters categories to only top-level ones (parentId is null or undefined).
 */
export function getTopLevelCategories<T extends CategoryLike>(categories: T[]): T[] {
  return categories.filter((c) => c.parentId == null)
}

/**
 * Extracts the active category slug from the current pathname.
 * Understands both the `/hc/*` inline mount and the help center landing.
 * Returns null when not on a specific category.
 */
export function getActiveCategory(pathname: string): string | null {
  if (!pathname) return null
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'hc') return null
  return segments[1] ?? null
}

/**
 * Filters categories to find direct children of a given parent category.
 */
export function getSubcategories<T extends CategoryLike>(categories: T[], parentId: string): T[] {
  return categories.filter((c) => c.parentId === parentId)
}

interface CategoryLikeWithSlug {
  id: string
  parentId?: string | null
  slug: string
  name: string
}

/**
 * Walk from the given category up to its top-level ancestor.
 * Returns the chain ordered root-first. Empty array if id unknown.
 * Bails out on cycles rather than looping forever.
 */
function buildAncestorChain<T extends CategoryLikeWithSlug>(flat: T[], id: string): T[] {
  const byId = new Map(flat.map((c) => [c.id, c]))
  const start = byId.get(id)
  if (!start) return []
  const chain: T[] = []
  const seen = new Set<string>()
  let current: T | undefined = start
  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    chain.push(current)
    if (!current.parentId) break
    current = byId.get(current.parentId)
  }
  return chain.reverse()
}

/**
 * Builds breadcrumb items walking the full ancestor chain of a category.
 * Each non-final crumb links to its category page; the final crumb (article
 * title if provided, otherwise the category name) has no href.
 */
export function buildCategoryBreadcrumbs<T extends CategoryLikeWithSlug>(params: {
  allCategories: T[]
  categoryId: string
  articleTitle?: string
}): Array<{ label: string; href?: string }> {
  const chain = buildAncestorChain(params.allCategories, params.categoryId)
  const items: Array<{ label: string; href?: string }> = [{ label: 'Help Center', href: '/hc' }]

  if (chain.length === 0) {
    // Unknown id — return just Help Center. The article fallback is
    // intentionally omitted because without the chain we can't produce
    // meaningful intermediate links, and a single "Help Center > Article"
    // breadcrumb misleads the reader about where the article actually lives.
    return items
  }

  chain.forEach((cat, index) => {
    const isLast = index === chain.length - 1
    if (isLast && !params.articleTitle) {
      items.push({ label: cat.name })
    } else {
      items.push({ label: cat.name, href: `/hc/${cat.slug}` })
    }
  })

  if (params.articleTitle) {
    items.push({ label: params.articleTitle })
  }

  return items
}
