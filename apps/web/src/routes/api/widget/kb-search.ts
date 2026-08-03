import { createFileRoute } from '@tanstack/react-router'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { hybridSearch } from '@/lib/server/domains/help-center/help-center-search.service'
import { getWidgetRequestContext } from '@/lib/server/widget/context'
import { mapDomainErrorToResponse, widgetCorsHeaders } from '@/lib/server/widget/cors'
import type { HelpCenterArticleId, HelpCenterCategoryId } from '@quackback/ids'

import { logger } from '@/lib/server/logger'
const log = logger.child({ component: 'widget-kb-search' })
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
          const widgetContext = await getWidgetRequestContext(request)
          const helpFilters = widgetContext.contentFilters.help
          const allowedCategoryIds = new Set(helpFilters?.categoryIds ?? [])
          const allowedArticleIds = new Set(helpFilters?.articleIds ?? [])
          const results = await hybridSearch(q, limit)

          const articles = results
            .filter((a) => {
              if (
                allowedCategoryIds.size > 0 &&
                !allowedCategoryIds.has(a.categoryId as HelpCenterCategoryId)
              ) {
                return false
              }
              if (
                allowedArticleIds.size > 0 &&
                !allowedArticleIds.has(a.id as HelpCenterArticleId)
              ) {
                return false
              }
              return true
            })
            .map((a) => ({
              id: a.id,
              slug: a.slug,
              title: a.title,
              content: a.content?.slice(0, 200) ?? '',
              category: { id: a.categoryId, slug: a.categorySlug, name: a.categoryName },
            }))

          return Response.json({ data: { articles } }, { headers: corsHeaders() })
        } catch (error) {
          const mapped = mapDomainErrorToResponse(error)
          if (mapped) return mapped
          log.error({ err: error }, 'Search failed')
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
  return widgetCorsHeaders()
}
