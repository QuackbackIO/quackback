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
