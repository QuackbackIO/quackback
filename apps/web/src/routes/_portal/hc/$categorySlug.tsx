import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import {
  getPublicCategoryBySlugFn,
  listPublicArticlesForCategoryFn,
  listPublicCategoriesFn,
} from '@/lib/server/functions/help-center'
import { getSubcategories } from '@/components/help-center/help-center-utils'
import { HelpCenterSidebar } from '@/components/help-center/help-center-sidebar'

export const Route = createFileRoute('/_portal/hc/$categorySlug')({
  loader: async ({ params }) => {
    let category: Awaited<ReturnType<typeof getPublicCategoryBySlugFn>>
    try {
      category = await getPublicCategoryBySlugFn({ data: { slug: params.categorySlug } })
    } catch {
      throw notFound()
    }

    // Load articles for this category and all categories in parallel
    const [articles, allCategories] = await Promise.all([
      listPublicArticlesForCategoryFn({ data: { categoryId: category.id } }),
      listPublicCategoriesFn({ data: {} }),
    ])

    // Find subcategories
    const subcategories = getSubcategories(allCategories, category.id)

    // Load articles for each subcategory (count is small so this is acceptable)
    const subcategoryArticles = await Promise.all(
      subcategories.map(async (sub) => ({
        ...sub,
        articles: await listPublicArticlesForCategoryFn({ data: { categoryId: sub.id } }),
      }))
    )

    return { category, articles, subcategories: subcategoryArticles, allCategories }
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
  const { category, articles, subcategories } = Route.useLoaderData()

  return (
    <div className="mx-auto flex max-w-7xl">
      <HelpCenterSidebar
        categoryName={category.name}
        categorySlug={category.slug}
        categoryIcon={category.icon}
        articles={articles}
        subcategories={subcategories}
      />
      <div className="min-w-0 flex-1 px-6 py-6 sm:px-10">
        <Outlet />
      </div>
    </div>
  )
}
