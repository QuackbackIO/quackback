import { createFileRoute } from '@tanstack/react-router'
import type { SitemapArticle } from '@/lib/shared/help-center-sitemap'

export const Route = createFileRoute('/hc/sitemap.xml')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [
          { isFeatureEnabled },
          { listPublicCategories, listPublicArticles },
          { buildHelpCenterSitemapUrls },
          { renderSitemap },
        ] = await Promise.all([
          import('@/lib/server/domains/settings/settings.service'),
          import('@/lib/server/domains/help-center/help-center.service'),
          import('@/lib/shared/help-center-sitemap'),
          import('@/lib/server/sitemap'),
        ])

        if (!(await isFeatureEnabled('helpCenter'))) {
          return new Response('Not Found', { status: 404 })
        }

        const url = new URL(request.url)
        const baseUrl = url.origin
        const pageParam = url.searchParams.get('page')
        const page = pageParam ? parseInt(pageParam, 10) : null

        // Fetch all public categories and published articles
        const [categories, articleResult] = await Promise.all([
          listPublicCategories(),
          listPublicArticles({ limit: 50000 }),
        ])

        // Map articles to the shape expected by the URL builder.
        // Service returns Date objects; the builder expects ISO strings.
        const articles: SitemapArticle[] = articleResult.items.map((a) => ({
          slug: a.slug,
          updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : String(a.updatedAt),
          category: { slug: a.category.slug },
        }))

        const allUrls = buildHelpCenterSitemapUrls(baseUrl, categories, articles)
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
