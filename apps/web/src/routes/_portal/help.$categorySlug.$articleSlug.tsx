import { createFileRoute, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { HelpCenterArticleDetail } from '@/components/portal/help-center'
import { BackLink } from '@/components/ui/back-link'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

export const Route = createFileRoute('/_portal/help/$categorySlug/$articleSlug')({
  loader: async ({ context, params }) => {
    const flags = context.settings?.featureFlags as FeatureFlags | undefined
    if (!flags?.helpCenter) throw notFound()

    const { queryClient } = context

    let article
    try {
      article = await queryClient.ensureQueryData(
        publicHelpCenterQueries.articleBySlug(params.articleSlug)
      )
    } catch {
      throw notFound()
    }

    return {
      articleSlug: params.articleSlug,
      categorySlug: params.categorySlug,
      articleTitle: article.title,
      categoryName: article.category.name,
      workspaceName: context.settings?.name ?? 'Quackback',
      baseUrl: context.baseUrl ?? '',
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { articleTitle, categoryName, workspaceName, baseUrl, categorySlug, articleSlug } =
      loaderData
    const title = `${articleTitle} - ${categoryName} - ${workspaceName}`
    const description = `${articleTitle}. Help article from ${workspaceName}.`
    const canonicalUrl = baseUrl ? `${baseUrl}/help/${categorySlug}/${articleSlug}` : ''
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
  notFoundComponent: ArticleNotFound,
  component: ArticlePage,
})

function ArticlePage() {
  const { articleSlug, categorySlug } = Route.useLoaderData()
  const { data: article } = useSuspenseQuery(publicHelpCenterQueries.articleBySlug(articleSlug))

  return (
    <div className="py-8">
      <div className="animate-in fade-in duration-200 fill-mode-backwards">
        <HelpCenterArticleDetail
          id={article.id}
          title={article.title}
          content={article.content}
          contentJson={article.contentJson}
          categorySlug={categorySlug}
          categoryName={article.category.name}
          author={article.author}
          helpfulCount={article.helpfulCount}
          notHelpfulCount={article.notHelpfulCount}
        />
      </div>
    </div>
  )
}

function ArticleNotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-bold mb-2">Article not found</h1>
      <p className="text-muted-foreground mb-6">
        This article may have been removed or is not yet published.
      </p>
      <BackLink to="/help">Help Center</BackLink>
    </div>
  )
}
