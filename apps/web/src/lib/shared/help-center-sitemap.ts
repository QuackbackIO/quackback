/**
 * Pure help center sitemap URL builders.
 * Builds SitemapUrl[] from categories and articles for the help center sitemap.
 */
import type { SitemapUrl } from '@/lib/server/sitemap'

export interface SitemapCategory {
  slug: string
}

export interface SitemapArticle {
  slug: string
  updatedAt: string
  category: { slug: string }
}

/**
 * Build sitemap URLs for the help center.
 * - Landing page (no lastmod)
 * - Each category page (no lastmod)
 * - Each article page (with lastmod from updatedAt)
 */
export function buildHelpCenterSitemapUrls(
  baseUrl: string,
  categories: SitemapCategory[],
  articles: SitemapArticle[]
): SitemapUrl[] {
  const urls: SitemapUrl[] = []

  // Landing page
  urls.push({ loc: baseUrl })

  // Category pages
  for (const cat of categories) {
    urls.push({ loc: `${baseUrl}/${cat.slug}` })
  }

  // Article pages
  for (const article of articles) {
    urls.push({
      loc: `${baseUrl}/${article.category.slug}/${article.slug}`,
      lastmod: article.updatedAt.split('T')[0],
    })
  }

  return urls
}
