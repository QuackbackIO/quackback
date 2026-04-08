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
 * Returns null for the landing page (/).
 */
export function getActiveCategory(pathname: string): string | null {
  if (!pathname || pathname === '/') return null
  const segments = pathname.split('/').filter(Boolean)
  return segments[0] ?? null
}

/**
 * Truncates content to a maximum length, appending ellipsis if needed.
 */
export function truncateContent(content: string, maxLength = 150): string {
  if (content.length <= maxLength) return content
  return content.slice(0, maxLength) + '...'
}

/**
 * Filters categories to find direct children of a given parent category.
 */
export function getSubcategories<T extends CategoryLike>(categories: T[], parentId: string): T[] {
  return categories.filter((c) => c.parentId === parentId)
}

/**
 * Builds breadcrumb items for a category page or article page.
 * The last item has no href (it's the current page).
 */
export function buildCategoryBreadcrumbs(params: {
  categoryName: string
  categorySlug: string
  articleTitle?: string
}): Array<{ label: string; href?: string }> {
  const items: Array<{ label: string; href?: string }> = [{ label: 'Help Center', href: '/hc' }]

  if (params.articleTitle) {
    items.push({
      label: params.categoryName,
      href: `/hc/${params.categorySlug}`,
    })
    items.push({ label: params.articleTitle })
  } else {
    items.push({ label: params.categoryName })
  }

  return items
}
