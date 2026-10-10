import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { KbArticleId, PrincipalId } from '@quackback/ids'
import { listPublicArticlesSchema } from '@/lib/shared/schemas/help-center'
import { toIsoStringOrNull } from '@/lib/shared/utils'

const localeSchema = z.object({ locale: z.string().optional() })

export const widgetListPublicCategoriesFn = createServerFn({ method: 'GET' })
  .validator(localeSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveHelpPublicViewer, serializeCategory } = await import('../help-center')
    const { listPublicCategoriesForLocale } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const { DEFAULT_LOCALE } = await import('@/lib/shared/i18n')
    const categories = await listPublicCategoriesForLocale(
      data.locale ?? DEFAULT_LOCALE,
      await resolveHelpPublicViewer(await getOptionalWidgetAuth())
    )
    return categories.map(serializeCategory)
  })

export const widgetListPublicArticlesForCategoryFn = createServerFn({ method: 'GET' })
  .validator(z.object({ categoryId: z.string(), locale: z.string().optional() }))
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveHelpPublicViewer } = await import('../help-center')
    const { listPublicArticlesForCategoryLocale } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const { DEFAULT_LOCALE } = await import('@/lib/shared/i18n')
    const articles = await listPublicArticlesForCategoryLocale(
      data.categoryId,
      data.locale ?? DEFAULT_LOCALE,
      await resolveHelpPublicViewer(await getOptionalWidgetAuth())
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
    const { resolveHelpPublicViewer, serializeArticle } = await import('../help-center')
    const { canonicalArticleTypeId } = await import('@/lib/shared/widget/article-ref')
    const { getPublicArticleByIdForLocale, getPublicArticleBySlugForLocale } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const { DEFAULT_LOCALE } = await import('@/lib/shared/i18n')
    const { NotFoundError } = await import('@/lib/shared/errors')
    const { withDefaultLocaleFallback } = await import('@/lib/shared/widget/article-locale')
    const viewer = await resolveHelpPublicViewer(await getOptionalWidgetAuth())
    const locale = data.locale ?? DEFAULT_LOCALE
    try {
      const kbId = canonicalArticleTypeId(data.ref)
      const load = (loc: string) =>
        kbId
          ? getPublicArticleByIdForLocale(kbId, loc, viewer)
          : getPublicArticleBySlugForLocale(data.ref, loc, viewer)
      const { value: article, locale: resolvedLocale } = await withDefaultLocaleFallback(
        locale,
        DEFAULT_LOCALE,
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

export const widgetListPublicArticlesFn = createServerFn({ method: 'GET' })
  .validator(listPublicArticlesSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { resolveHelpPublicViewer, serializeArticle } = await import('../help-center')
    const { listPublicArticles } =
      await import('@/lib/server/domains/help-center/help-center.article.query')
    const result = await listPublicArticles(
      data,
      await resolveHelpPublicViewer(await getOptionalWidgetAuth())
    )
    return {
      ...result,
      items: result.items.map(serializeArticle),
    }
  })
