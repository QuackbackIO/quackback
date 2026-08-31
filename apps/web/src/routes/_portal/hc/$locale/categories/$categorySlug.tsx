import { createFileRoute, redirect, notFound, Outlet } from '@tanstack/react-router'
import { getPublicCategoryBySlugFn } from '@/lib/server/functions/help-center'
import { hcCollectionPath } from '@/lib/shared/help-center-url'

/**
 * Legacy `/hc/{locale}/categories/{slug}` → `/hc/{locale}/collections/{urlId}-{slug}`.
 */
export const Route = createFileRoute('/_portal/hc/$locale/categories/$categorySlug')({
  beforeLoad: async ({ params }) => {
    const category = await getPublicCategoryBySlugFn({
      data: { slug: params.categorySlug, locale: params.locale },
    }).catch(() => null)
    if (!category) throw notFound()
    throw redirect({
      href: hcCollectionPath({
        locale: params.locale,
        urlId: category.urlId,
        slug: category.slug,
      }),
      statusCode: 301,
    })
  },
  component: () => <Outlet />,
})
