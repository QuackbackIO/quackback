import { createFileRoute, notFound } from '@tanstack/react-router'
import { PageHeader } from '@/components/shared/page-header'
import { BackLink } from '@/components/ui/back-link'
import { HelpCenterArticleList } from '@/components/portal/help-center'
import { getPublicCategoryBySlugFn } from '@/lib/server/functions/help-center'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

export const Route = createFileRoute('/_portal/help/$categorySlug/')({
  loader: async ({ params, context }) => {
    const flags = context.settings?.featureFlags as FeatureFlags | undefined
    if (!flags?.helpCenter) throw notFound()

    try {
      const category = await getPublicCategoryBySlugFn({ data: { slug: params.categorySlug } })
      return {
        category: {
          id: category.id,
          slug: category.slug,
          name: category.name,
          description: category.description,
        },
        workspaceName: context.settings?.name ?? 'Quackback',
        baseUrl: context.baseUrl ?? '',
      }
    } catch {
      throw notFound()
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { category, workspaceName, baseUrl } = loaderData
    const title = `${category.name} - Help Center - ${workspaceName}`
    const description = category.description || `Help articles about ${category.name}.`
    const canonicalUrl = baseUrl ? `${baseUrl}/help/${category.slug}` : ''
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(canonicalUrl ? [{ property: 'og:url', content: canonicalUrl }] : []),
      ],
      links: canonicalUrl ? [{ rel: 'canonical', href: canonicalUrl }] : [],
    }
  },
  notFoundComponent: CategoryNotFound,
  component: CategoryPage,
})

function CategoryPage() {
  const { category } = Route.useLoaderData()

  return (
    <div className="py-8">
      <BackLink to="/help" className="mb-6">
        Help Center
      </BackLink>

      <PageHeader
        size="large"
        title={category.name}
        description={category.description ?? undefined}
        animate
        className="mb-8"
      />

      <div
        className="animate-in fade-in duration-300 fill-mode-backwards"
        style={{ animationDelay: '100ms' }}
      >
        <HelpCenterArticleList categoryId={category.id} categorySlug={category.slug} />
      </div>
    </div>
  )
}

function CategoryNotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-bold mb-2">Category not found</h1>
      <p className="text-muted-foreground mb-6">
        This category may have been removed or does not exist.
      </p>
      <BackLink to="/help">Help Center</BackLink>
    </div>
  )
}
