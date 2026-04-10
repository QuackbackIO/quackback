/**
 * Pure JSON-LD structured data builders for help center pages.
 * These generate schema.org objects ready for <script type="application/ld+json"> injection.
 */

// ============================================================================
// Types
// ============================================================================

export interface ArticleJsonLdInput {
  title: string
  description: string | null
  content: string | null
  authorName: string | null
  publishedAt: string | null
  updatedAt: string
  baseUrl: string
  categorySlug: string
  categoryName: string
  articleSlug: string
}

export interface BreadcrumbItem {
  name: string
  url: string
}

export interface CollectionPageJsonLdInput {
  name: string
  description: string | null
}

// ============================================================================
// Builders
// ============================================================================

/**
 * Build Article structured data (schema.org/Article).
 */
export function buildArticleJsonLd(input: ArticleJsonLdInput): Record<string, unknown> {
  const description =
    input.description || (input.content ? input.content.slice(0, 160) : input.title)

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description,
    dateModified: input.updatedAt,
  }

  if (input.authorName) {
    jsonLd.author = { '@type': 'Person', name: input.authorName }
  }

  if (input.publishedAt) {
    jsonLd.datePublished = input.publishedAt
  }

  return jsonLd
}

/**
 * Build BreadcrumbList structured data (schema.org/BreadcrumbList).
 */
export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}

/**
 * Build CollectionPage structured data (schema.org/CollectionPage).
 */
export function buildCollectionPageJsonLd(
  input: CollectionPageJsonLdInput
): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: input.name,
  }

  if (input.description) {
    jsonLd.description = input.description
  }

  return jsonLd
}
