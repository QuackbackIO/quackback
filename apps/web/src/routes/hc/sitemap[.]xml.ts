import { createFileRoute } from '@tanstack/react-router'
import type { SitemapArticle, LocaleSitemapEntry } from '@/lib/shared/help-center-sitemap'

export const Route = createFileRoute('/hc/sitemap.xml')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [
          { isFeatureEnabled, getHelpCenterConfig },
          { listPublicCategories, listPublicArticles },
          { listPublicCategoriesForLocale, listPublicArticlesForCategoryLocale },
          { buildHelpCenterSitemapUrls, buildHelpCenterSitemapUrlsMultiLocale },
          { renderSitemap },
        ] = await Promise.all([
          import('@/lib/server/domains/settings/settings.service'),
          import('@/lib/server/domains/help-center/help-center.service'),
          import('@/lib/server/domains/help-center/help-center-locale.query'),
          import('@/lib/shared/help-center-sitemap'),
          import('@/lib/server/sitemap'),
        ])

        if (!(await isFeatureEnabled('helpCenter'))) {
          return new Response('Not Found', { status: 404 })
        }

        const helpCenterConfig = await getHelpCenterConfig()
        if (!helpCenterConfig.enabled) {
          return new Response('Not Found', { status: 404 })
        }

        // Indexing toggle (domains/languages §1): an operator that turned off
        // "allow search engines to index" doesn't want a sitemap advertised either.
        if (helpCenterConfig.seo?.indexable === false) {
          return new Response('Not Found', { status: 404 })
        }

        const url = new URL(request.url)
        const baseUrl = url.origin
        const pageParam = url.searchParams.get('page')
        const page = pageParam ? parseInt(pageParam, 10) : null

        const additionalLocales = helpCenterConfig.locales?.additional ?? []
        const defaultLocale = helpCenterConfig.locales?.default ?? 'en'

        let allUrls
        if (additionalLocales.length === 0) {
          // Fetch all public categories and published articles
          const [categories, articleResult] = await Promise.all([
            listPublicCategories(),
            listPublicArticles({ limit: 50000 }),
          ])

          // Map articles to the shape expected by the URL builder.
          // Service returns Date objects; the builder expects ISO strings.
          const articles: SitemapArticle[] = articleResult.items.map((a) => ({
            slug: a.slug,
            updatedAt:
              a.updatedAt instanceof Date ? a.updatedAt.toISOString() : String(a.updatedAt),
            category: { slug: a.category.slug },
          }))

          allUrls = buildHelpCenterSitemapUrls(baseUrl, categories, articles)
        } else {
          // Per-locale gating (domains/languages §1/§2): each additional
          // locale only includes categories/articles that are actually
          // translated there; the builder cross-links matching entities by id.
          const perLocale: LocaleSitemapEntry[] = []
          for (const locale of [defaultLocale, ...additionalLocales]) {
            const categories = await listPublicCategoriesForLocale(locale)
            const articlesByCategory = await Promise.all(
              categories.map(async (cat) => ({
                categorySlug: cat.slug,
                articles: await listPublicArticlesForCategoryLocale(cat.id, locale),
              }))
            )
            perLocale.push({
              locale,
              categories: categories.map((c) => ({ id: c.id, slug: c.slug })),
              articles: articlesByCategory.flatMap(({ categorySlug, articles }) =>
                articles.map((a) => ({
                  id: a.id,
                  slug: a.slug,
                  // The locale-gated article list projects publishedAt, not
                  // updatedAt (list-view summary shape) -- a reasonable
                  // lastmod proxy given the alternative is omitting it.
                  updatedAt:
                    a.publishedAt instanceof Date
                      ? a.publishedAt.toISOString()
                      : new Date().toISOString(),
                  category: { slug: categorySlug },
                }))
              ),
            })
          }
          allUrls = buildHelpCenterSitemapUrlsMultiLocale(baseUrl, defaultLocale, perLocale)
        }

        const xml = renderSitemap(allUrls, baseUrl, isNaN(page as number) ? null : page)

        if (!xml) {
          return new Response('Not Found', { status: 404 })
        }

        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      },
    },
  },
})
