import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import { getPublicCategoryPageFn } from '@/lib/server/functions/help-center'
import { HelpCenterHero } from '@/components/help-center/help-center-hero'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'

export const Route = createFileRoute('/_portal/hc/categories/$categorySlug')({
  loader: async ({ params }) => {
    // One composed call replaces the prior category + categories + N-subcategory
    // article-fetch waterfall; it returns the same loader-data shape.
    try {
      return await getPublicCategoryPageFn({ data: { slug: params.categorySlug } })
    } catch {
      throw notFound()
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { category } = loaderData
    return {
      meta: [{ title: `${category.name} - Help Center` }],
    }
  },
  component: CategoryLayout,
})

function CategoryLayout() {
  const { settings } = Route.useRouteContext()
  const askAiEnabled = !!settings?.featureFlags?.helpCenterAiAnswers
  return (
    <>
      <HelpCenterHero variant="compact">
        <HelpCenterHeroSearch askAiEnabled={askAiEnabled} />
      </HelpCenterHero>
      <Outlet />
    </>
  )
}
