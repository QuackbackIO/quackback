import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import {
  getPublicCategoryBySlugFn,
  listPublicArticlesForCategoryFn,
  listPublicCategoriesFn,
} from '@/lib/server/functions/help-center'
import { getSubcategories } from '@/components/help-center/help-center-utils'
import { HelpCenterHero } from '@/components/help-center/help-center-hero'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'

export const Route = createFileRoute('/_portal/hc/articles/$categorySlug')({
  loader: async ({ params }) => {
    let category: Awaited<ReturnType<typeof getPublicCategoryBySlugFn>>
    try {
      category = await getPublicCategoryBySlugFn({ data: { slug: params.categorySlug } })
    } catch {
      throw notFound()
    }

    const [articles, allCategories] = await Promise.all([
      listPublicArticlesForCategoryFn({ data: { categoryId: category.id } }),
      listPublicCategoriesFn({ data: {} }),
    ])

    const subcategories = getSubcategories(allCategories, category.id)

    const subcategoryArticles = await Promise.all(
      subcategories.map(async (sub) => ({
        ...sub,
        articles: await listPublicArticlesForCategoryFn({ data: { categoryId: sub.id } }),
      }))
    )

    return { category, articles, subcategories: subcategoryArticles, allCategories }
  },
  component: ArticleLayout,
})

function ArticleLayout() {
  const { settings } = Route.useRouteContext()
  const askAiEnabled = !!settings?.featureFlags?.helpCenterAiAnswers
  return (
    <>
      <HelpCenterHero variant="compact">
        <HelpCenterHeroSearch askAiEnabled={askAiEnabled} />
      </HelpCenterHero>
      <div className="mx-auto max-w-7xl">
        <Outlet />
      </div>
    </>
  )
}
