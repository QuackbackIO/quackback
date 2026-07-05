import { createFileRoute } from '@tanstack/react-router'
import { isFeatureEnabled, getHelpCenterConfig } from '@/lib/server/domains/settings/settings.service'
import {
  hybridSearchForLocale,
  resolveSearchLocale,
} from '@/lib/server/domains/help-center/help-center-search.service'
import {
  enforcePerIpLimit,
  widgetCorsHeaders,
  widgetJsonError,
} from '@/lib/server/widget/public-endpoint'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'widget-kb-search' })

/** Generous per-IP allowance: typing in the search box fires many requests. */
export const KB_SEARCH_RATE_LIMIT = 60
const RATE_WINDOW_SECONDS = 60

export async function handleKbSearch({ request }: { request: Request }): Promise<Response> {
  if (!(await isFeatureEnabled('helpCenter'))) {
    return widgetJsonError(404, 'NOT_FOUND', 'Knowledge base not found')
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim()
  const limit = Math.min(Number(url.searchParams.get('limit')) || 10, 20)

  if (!q) {
    return Response.json({ data: { articles: [] } }, { headers: widgetCorsHeaders() })
  }

  const limited = await enforcePerIpLimit(request, {
    keyPrefix: 'kbsearch',
    limit: KB_SEARCH_RATE_LIMIT,
    windowSeconds: RATE_WINDOW_SECONDS,
    message: 'Too many searches, slow down',
  })
  if (limited) return limited

  try {
    // The widget passes its own UI locale through (domains/languages §2); an
    // unrecognized or not-enabled locale silently falls back to default
    // rather than searching an empty translation table.
    const requestedLocale = url.searchParams.get('locale') ?? undefined
    const config = await getHelpCenterConfig()
    const locale = resolveSearchLocale(requestedLocale, config.locales.additional, config.locales.default)
    const results = await hybridSearchForLocale(q, locale, limit)

    const articles = results.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      content: a.content?.slice(0, 200) ?? '',
      category: { id: a.categoryId, slug: a.categorySlug, name: a.categoryName },
    }))

    return Response.json({ data: { articles } }, { headers: widgetCorsHeaders() })
  } catch (error) {
    log.error({ err: error }, 'kb search failed')
    return widgetJsonError(500, 'SERVER_ERROR', 'Search failed')
  }
}

export const Route = createFileRoute('/api/widget/kb-search')({
  server: {
    handlers: {
      GET: handleKbSearch,
    },
  },
})
