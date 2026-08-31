import { createFileRoute, redirect, notFound } from '@tanstack/react-router'
import { getPublicArticleBySlugFn } from '@/lib/server/functions/help-center'
import { hcArticlePath } from '@/lib/shared/help-center-url'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'

/**
 * Legacy `/hc/articles/{categorySlug}/{articleSlug}` →
 * `/hc/{locale}/articles/{urlId}-{slug}`.
 */
export const Route = createFileRoute('/_portal/hc/articles/$categorySlug/$articleSlug')({
  beforeLoad: async ({ params, context }) => {
    const locale =
      (context.settings?.helpCenterConfig as HelpCenterConfig | undefined)?.locales?.default ?? 'en'
    const article = await getPublicArticleBySlugFn({
      data: { slug: params.articleSlug },
    }).catch(() => null)
    if (!article) throw notFound()
    throw redirect({
      href: hcArticlePath({ locale, urlId: article.urlId, slug: article.slug }),
      statusCode: 301,
    })
  },
})
