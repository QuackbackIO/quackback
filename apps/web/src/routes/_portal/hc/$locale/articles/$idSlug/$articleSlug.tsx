import { createFileRoute, redirect, notFound } from '@tanstack/react-router'
import { getPublicArticleBySlugFn } from '@/lib/server/functions/help-center'
import { hcArticlePath } from '@/lib/shared/help-center-url'

/**
 * Legacy `/hc/{locale}/articles/{categorySlug}/{articleSlug}` →
 * `/hc/{locale}/articles/{urlId}-{slug}`.
 */
export const Route = createFileRoute('/_portal/hc/$locale/articles/$idSlug/$articleSlug')({
  beforeLoad: async ({ params }) => {
    const article = await getPublicArticleBySlugFn({
      data: { slug: params.articleSlug, locale: params.locale },
    }).catch(() => null)
    if (!article) throw notFound()
    throw redirect({
      href: hcArticlePath({
        locale: params.locale,
        urlId: article.urlId,
        slug: article.slug,
      }),
      statusCode: 301,
    })
  },
})
