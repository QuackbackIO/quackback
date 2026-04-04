import { createFileRoute } from '@tanstack/react-router'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { hybridSearch } from '@/lib/server/domains/help-center/help-center-search.service'

export const Route = createFileRoute('/api/widget/kb-search')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isFeatureEnabled('helpCenter'))) {
          return Response.json(
            { error: { code: 'NOT_FOUND', message: 'Knowledge base not found' } },
            { status: 404, headers: corsHeaders() }
          )
        }

        const url = new URL(request.url)
        const q = url.searchParams.get('q')?.trim()
        const limit = Math.min(Number(url.searchParams.get('limit')) || 10, 20)

        if (!q) {
          return Response.json({ data: { articles: [] } }, { headers: corsHeaders() })
        }

        try {
          const results = await hybridSearch(q, limit)

          const articles = results.map((a) => ({
            id: a.id,
            slug: a.slug,
            title: a.title,
            content: a.content?.slice(0, 200) ?? '',
            category: { slug: a.categorySlug, name: a.categoryName },
          }))

          return Response.json({ data: { articles } }, { headers: corsHeaders() })
        } catch (error) {
          console.error('[widget:kb-search] Error:', error)
          return Response.json(
            { error: { code: 'SERVER_ERROR', message: 'Search failed' } },
            { status: 500, headers: corsHeaders() }
          )
        }
      },
    },
  },
})

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  }
}
