/**
 * Pure help center sitemap URL builders.
 * Builds SitemapUrl[] from categories and articles for the help center sitemap.
 */
import type { SitemapUrl, SitemapAlternate } from '@/lib/server/sitemap'
import { localizedHcPath } from './help-center-url'

export interface SitemapCategory {
  slug: string
}

export interface SitemapArticle {
  slug: string
  updatedAt: string
  category: { slug: string }
}

/**
 * Build sitemap URLs for the help center. `baseUrl` is the site origin (no
 * path) -- every canonical /hc page lives under the `/hc` prefix on both the
 * default host and the (v1 fallback-shape) custom domain, so every entry
 * here does too.
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
  urls.push({ loc: `${baseUrl}/hc` })

  // Category pages
  for (const cat of categories) {
    urls.push({ loc: `${baseUrl}/hc/categories/${cat.slug}` })
  }

  // Article pages
  for (const article of articles) {
    urls.push({
      loc: `${baseUrl}/hc/articles/${article.category.slug}/${article.slug}`,
      lastmod: article.updatedAt.split('T')[0],
    })
  }

  return urls
}

// ============================================================================
// Multi-locale sitemap (domains/languages §2)
// ============================================================================

export interface LocaleSitemapCategory {
  id: string
  slug: string
}

export interface LocaleSitemapArticle {
  id: string
  slug: string
  updatedAt: string
  category: { slug: string }
}

export interface LocaleSitemapEntry {
  locale: string
  categories: LocaleSitemapCategory[]
  articles: LocaleSitemapArticle[]
}

function buildAlternates(
  pathsByLocale: Map<string, string>,
  defaultLocale: string
): SitemapAlternate[] {
  const alternates: SitemapAlternate[] = [...pathsByLocale.entries()].map(([hreflang, href]) => ({
    hreflang,
    href,
  }))
  const defaultHref = pathsByLocale.get(defaultLocale)
  if (defaultHref) alternates.push({ hreflang: 'x-default', href: defaultHref })
  return alternates
}

/**
 * Build sitemap URLs across every enabled help-center locale, with
 * cross-locale hreflang alternates for any category/article visible in more
 * than one locale (domains/languages §2). `perLocale` must include an entry
 * for the default locale (its gating is the existing published/public
 * predicate, not translation-based).
 */
export function buildHelpCenterSitemapUrlsMultiLocale(
  baseUrl: string,
  defaultLocale: string,
  perLocale: LocaleSitemapEntry[]
): SitemapUrl[] {
  const urls: SitemapUrl[] = []

  const landingByLocale = new Map(
    perLocale.map(({ locale }) => [locale, `${baseUrl}${localizedHcPath(locale, '/hc')}`])
  )
  for (const locale of landingByLocale.keys()) {
    urls.push({ loc: landingByLocale.get(locale)!, alternates: buildAlternates(landingByLocale, defaultLocale) })
  }

  const categoryPathsById = new Map<string, Map<string, string>>()
  for (const { locale, categories } of perLocale) {
    for (const cat of categories) {
      const path = `${baseUrl}${localizedHcPath(locale, `/hc/categories/${cat.slug}`)}`
      if (!categoryPathsById.has(cat.id)) categoryPathsById.set(cat.id, new Map())
      categoryPathsById.get(cat.id)!.set(locale, path)
    }
  }
  for (const pathsByLocale of categoryPathsById.values()) {
    const alternates = buildAlternates(pathsByLocale, defaultLocale)
    for (const loc of pathsByLocale.values()) {
      urls.push({ loc, alternates })
    }
  }

  const articlesById = new Map<string, Map<string, { path: string; lastmod: string }>>()
  for (const { locale, articles } of perLocale) {
    for (const article of articles) {
      const path = `${baseUrl}${localizedHcPath(locale, `/hc/articles/${article.category.slug}/${article.slug}`)}`
      if (!articlesById.has(article.id)) articlesById.set(article.id, new Map())
      articlesById
        .get(article.id)!
        .set(locale, { path, lastmod: article.updatedAt.split('T')[0] })
    }
  }
  for (const byLocale of articlesById.values()) {
    const pathsOnly = new Map([...byLocale].map(([locale, v]) => [locale, v.path]))
    const alternates = buildAlternates(pathsOnly, defaultLocale)
    for (const { path, lastmod } of byLocale.values()) {
      urls.push({ loc: path, lastmod, alternates })
    }
  }

  return urls
}
