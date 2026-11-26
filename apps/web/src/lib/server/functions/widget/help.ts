import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { KbArticleId, PrincipalId } from '@quackback/ids'
import { listPublicArticlesSchema } from '@/lib/shared/schemas/help-center'
import { toIsoStringOrNull } from '@/lib/shared/utils'

const localeSchema = z.object({ locale: z.string().optional() })

/**
 * The language the widget reads help content in: the visitor's own when the
 * help center has it turned on, the help center's default otherwise. Help
 * search follows the same rule.
 */
async function resolveHelpLocale(
  requested: string | undefined
): Promise<{ locale: string; defaultLocale: string }> {
  const { getHelpCenterConfig } = await import('@/lib/server/domains/settings/settings.service')
  const { resolveSearchLocale } =
    await import('@/lib/server/domains/help-center/help-center-search.service')
  const { locales } = await getHelpCenterConfig()
  return {
    locale: resolveSearchLocale(requested, locales.additional, locales.default),
    defaultLocale: locales.default,
  }
}

export const widgetListPublicCategoriesFn = createServerFn({ method: 'GET' })
  .validator(localeSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveHelpPublicReader, serializeCategory } = await import('../help-center')
    const { listPublicCategoriesWithFallback } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const reader = await resolveHelpPublicReader(await getOptionalWidgetAuth())
    if (!reader) return []
    const { locale } = await resolveHelpLocale(data.locale)
    const categories = await listPublicCategoriesWithFallback(locale, reader)
    return categories.map(serializeCategory)
  })

export const widgetListPublicArticlesForCategoryFn = createServerFn({ method: 'GET' })
  .validator(z.object({ categoryId: z.string(), locale: z.string().optional() }))
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveHelpPublicReader } = await import('../help-center')
    const { listPublicArticlesForCategoryWithFallback } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const reader = await resolveHelpPublicReader(await getOptionalWidgetAuth())
    if (!reader) return []
    const { locale } = await resolveHelpLocale(data.locale)
    const articles = await listPublicArticlesForCategoryWithFallback(
      data.categoryId,
      locale,
      reader
    )
    return articles.map((a) => ({
      ...a,
      publishedAt: toIsoStringOrNull(a.publishedAt),
    }))
  })

export const widgetResolvePublicArticleRefFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ref: z.string().min(1), locale: z.string().optional() }))
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveHelpPublicReader, serializeArticle } = await import('../help-center')
    const { canonicalArticleTypeId } = await import('@/lib/shared/widget/article-ref')
    const { getPublicArticleByIdForLocale, getPublicArticleBySlugForLocale } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const { NotFoundError } = await import('@/lib/shared/errors')
    const { withDefaultLocaleFallback } = await import('@/lib/shared/widget/article-locale')
    const viewer = await resolveHelpPublicReader(await getOptionalWidgetAuth())
    if (!viewer) return null
    const { locale, defaultLocale } = await resolveHelpLocale(data.locale)
    try {
      const kbId = canonicalArticleTypeId(data.ref)
      const load = (loc: string) =>
        kbId
          ? getPublicArticleByIdForLocale(kbId, loc, viewer)
          : getPublicArticleBySlugForLocale(data.ref, loc, viewer)
      const { value: article, locale: resolvedLocale } = await withDefaultLocaleFallback(
        locale,
        defaultLocale,
        load,
        (err) => err instanceof NotFoundError
      )
      const { helpfulCount: _h, notHelpfulCount: _n, ...publicArticle } = serializeArticle(article)
      return { ...publicArticle, resolvedLocale }
    } catch (err) {
      if (err instanceof NotFoundError) return null
      throw err
    }
  })

export const widgetRecordArticleFeedbackFn = createServerFn({ method: 'POST' })
  .validator(z.object({ articleId: z.string(), helpful: z.boolean() }))
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { assertHelpCenterOpenToRequest } = await import('../help-center')
    await assertHelpCenterOpenToRequest()
    const auth = await getOptionalWidgetAuth()
    const { recordArticleFeedback } =
      await import('@/lib/server/domains/help-center/help-center.service')
    const feedbackId = await recordArticleFeedback(
      data.articleId as KbArticleId,
      data.helpful,
      (auth?.principal?.id as PrincipalId) ?? null
    )
    return { success: true, feedbackId }
  })

/**
 * Count a widget open of an article, once per open, through the same
 * rate-limited view count as the help center page (once per article per
 * address an hour). Embeds do not call this, so they never count.
 */
export const widgetRecordArticleViewFn = createServerFn({ method: 'POST' })
  .validator(z.object({ articleId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveHelpPublicViewer } = await import('../help-center')
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getClientIp } = await import('@/lib/server/domains/api/rate-limit')
    const { countPublicArticleView } =
      await import('@/lib/server/domains/help-center/help-center.service')
    const counted = await countPublicArticleView(
      data.articleId,
      getClientIp(getRequestHeaders()),
      await resolveHelpPublicViewer(await getOptionalWidgetAuth())
    )
    return { success: true, counted }
  })

export const widgetListPublicArticlesFn = createServerFn({ method: 'GET' })
  .validator(listPublicArticlesSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveHelpPublicReader, serializeArticle } = await import('../help-center')
    const { listPublicArticles } =
      await import('@/lib/server/domains/help-center/help-center.article.query')
    const reader = await resolveHelpPublicReader(await getOptionalWidgetAuth())
    if (!reader) return { items: [], nextCursor: null, hasMore: false }
    const result = await listPublicArticles(data, reader)
    return {
      ...result,
      items: result.items.map(serializeArticle),
    }
  })
