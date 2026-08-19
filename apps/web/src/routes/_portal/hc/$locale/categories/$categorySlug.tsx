import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import {
  getPublicCategoryBySlugFn,
  listPublicArticlesForCategoryFn,
} from '@/lib/server/functions/help-center'
import { HelpCenterHero } from '@/components/help-center/help-center-hero'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'

/**
 * Locale-prefixed category layout. Simpler than the default-locale version
 * (no subcategory rollup sections) -- a bounded v1 scope for the translated
 * site; see /hc/categories/$categorySlug for the full-featured original.
 */
export const Route = createFileRoute('/_portal/hc/$locale/categories/$categorySlug')({
  loader: async ({ params }) => {
    let category: Awaited<ReturnType<typeof getPublicCategoryBySlugFn>>
    try {
      category = await getPublicCategoryBySlugFn({
        data: { slug: params.categorySlug, locale: params.locale },
      })
    } catch {
      throw notFound()
    }

    const articles = await listPublicArticlesForCategoryFn({
      data: { categoryId: category.id, locale: params.locale },
    })

    return { category, articles }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    return { meta: [{ title: `${loaderData.category.name} - Help Center` }] }
  },
  component: LocaleCategoryLayout,
})

function LocaleCategoryLayout() {
  const { locale } = Route.useParams()
  return (
    <>
      <HelpCenterHero variant="compact">
        <HelpCenterHeroSearch locale={locale} />
      </HelpCenterHero>
      <Outlet />
    </>
  )
}
