import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import {
  getPublicCategoryBySlugFn,
  listPublicArticlesForCategoryFn,
} from '@/lib/server/functions/help-center'
import { HelpCenterHero } from '@/components/help-center/help-center-hero'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'

/** Locale-prefixed article layout -- see the H1 comment on the sibling categories layout. */
export const Route = createFileRoute('/_portal/hc/$locale/articles/$categorySlug')({
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
  component: LocaleArticleLayout,
})

function LocaleArticleLayout() {
  const { locale } = Route.useParams()
  return (
    <>
      <HelpCenterHero variant="compact">
        <HelpCenterHeroSearch locale={locale} />
      </HelpCenterHero>
      <div className="mx-auto max-w-7xl">
        <Outlet />
      </div>
    </>
  )
}
