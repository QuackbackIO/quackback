/**
 * Pure utility functions for the help center UI.
 * Extracted for testability — no React dependencies.
 */

import { hcCollectionPath } from '@/lib/shared/help-center-url'
import { buildAncestorChain } from '@/lib/shared/help-center-tree'

interface CategoryLike {
  parentId?: string | null
}

/**
 * Filters categories to only top-level ones (parentId is null or undefined).
 */
export function getTopLevelCategories<T extends CategoryLike>(categories: T[]): T[] {
  return categories.filter((c) => c.parentId == null)
}

interface CategoryLikeWithSlug {
  id: string
  urlId: number
  parentId: string | null
  slug: string
  name: string
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
  /** Locale for collection URLs. Defaults to `en`. */
  locale?: string
}): Array<{ label: string; href?: string }> {
  const locale = params.locale ?? 'en'
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
      items.push({
        label: cat.name,
        href: hcCollectionPath({ locale, urlId: cat.urlId, slug: cat.slug }),
      })
    }
  })

  if (params.articleTitle) {
    items.push({ label: params.articleTitle })
  }

  return items
}
