import { createFileRoute, redirect, notFound, Outlet } from '@tanstack/react-router'
import { getPublicCategoryBySlugFn } from '@/lib/server/functions/help-center'
import { hcCollectionPath } from '@/lib/shared/help-center-url'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'

/**
 * Legacy `/hc/categories/{slug}` → `/hc/{locale}/collections/{urlId}-{slug}`.
 */
export const Route = createFileRoute('/_portal/hc/categories/$categorySlug')({
  beforeLoad: async ({ params, context }) => {
    const locale =
      (context.settings?.helpCenterConfig as HelpCenterConfig | undefined)?.locales?.default ?? 'en'
    const category = await getPublicCategoryBySlugFn({
      data: { slug: params.categorySlug },
    }).catch(() => null)
    if (!category) throw notFound()
    throw redirect({
      href: hcCollectionPath({ locale, urlId: category.urlId, slug: category.slug }),
      statusCode: 301,
    })
  },
  component: () => <Outlet />,
})
