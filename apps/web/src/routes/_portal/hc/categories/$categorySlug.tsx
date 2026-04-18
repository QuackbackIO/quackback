import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import {
  getPublicCategoryBySlugFn,
  listPublicArticlesForCategoryFn,
  listPublicCategoriesFn,
} from '@/lib/server/functions/help-center'
import { getSubcategories } from '@/components/help-center/help-center-utils'

export const Route = createFileRoute('/_portal/hc/categories/$categorySlug')({
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
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { category } = loaderData
    return {
      meta: [{ title: `${category.name} - Help Center` }],
    }
  },
  component: () => <Outlet />,
})
