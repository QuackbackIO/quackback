import { createFileRoute, getRouteApi, notFound } from '@tanstack/react-router'
import { getPublicArticleBySlugFn } from '@/lib/server/functions/help-center'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
import { HelpCenterBreadcrumbs } from '@/components/help-center/help-center-breadcrumbs'
import { HelpCenterToc } from '@/components/help-center/help-center-toc'
import { HelpCenterPrevNext } from '@/components/help-center/help-center-prev-next'
import { HelpCenterArticleFeedback } from '@/components/help-center/help-center-article-feedback'
import { buildCategoryBreadcrumbs } from '@/components/help-center/help-center-utils'
import {
  extractHeadings,
  computePrevNext,
} from '@/components/help-center/help-center-article-utils'
import { JsonLd } from '@/components/json-ld'
import { buildArticleJsonLd, buildBreadcrumbJsonLd } from '@/lib/shared/json-ld'
import type { JSONContent } from '@tiptap/react'

const helpCenterApi = getRouteApi('/_helpcenter')
const categoryApi = getRouteApi('/_helpcenter/$categorySlug')

export const Route = createFileRoute('/hc/$categorySlug/$articleSlug')({
  loader: async ({ params }) => {
    try {
      const article = await getPublicArticleBySlugFn({ data: { slug: params.articleSlug } })
      return { article }
    } catch {
      throw notFound()
    }
  },
  head: ({ loaderData, params, matches }) => {
    if (!loaderData) return {}

    const { article } = loaderData

    // Get workspace name from the root helpcenter layout
    const helpCenterMatch = matches.find((m) => m.routeId === '/_helpcenter')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentLoaderData = helpCenterMatch?.loaderData as Record<string, any> | undefined
    const workspaceName =
      (parentLoaderData?.org as Record<string, string> | undefined)?.name ?? 'Help Center'

    // Build description: use article description or first 160 chars of content
    const description =
      article.description ||
      (article.content ? article.content.slice(0, 160) : `${article.title} - ${workspaceName}`)

    const baseUrl =
      ((helpCenterMatch?.context as Record<string, any> | undefined)?.baseUrl as string) ?? ''
    const canonicalUrl = `${baseUrl}/${params.categorySlug}/${params.articleSlug}`

    return {
      meta: [
        { title: `${article.title} - ${workspaceName}` },
        { name: 'description', content: description },
        { property: 'og:title', content: `${article.title} - ${workspaceName}` },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'article' },
        { property: 'og:url', content: canonicalUrl },
      ],
      links: [{ rel: 'canonical', href: canonicalUrl }],
    }
  },
  component: ArticleDetailPage,
})

function ArticleDetailPage() {
  const { article } = Route.useLoaderData()
  const { categorySlug } = Route.useParams()
  const { category, articles } = categoryApi.useLoaderData()
  const { helpCenterConfig } = helpCenterApi.useLoaderData()
  const { baseUrl } = Route.useRouteContext()

  const breadcrumbs = buildCategoryBreadcrumbs({
    categoryName: category.name,
    categorySlug: category.slug,
    articleTitle: article.title,
  })

  const headings = extractHeadings(article.contentJson)
  const { prev, next } = computePrevNext(articles, article.slug)

  const seoEnabled = helpCenterConfig?.seo?.structuredDataEnabled !== false
  const resolvedBaseUrl = baseUrl ?? ''

  return (
    <div>
      {seoEnabled && (
        <>
          <JsonLd
            data={buildArticleJsonLd({
              title: article.title,
              description: article.description ?? null,
              content: article.content ?? null,
              authorName: article.author?.name ?? null,
              publishedAt: article.publishedAt ?? null,
              updatedAt: article.updatedAt,
              baseUrl: resolvedBaseUrl,
              categorySlug: category.slug,
              categoryName: category.name,
              articleSlug: article.slug,
            })}
          />
          <JsonLd
            data={buildBreadcrumbJsonLd([
              { name: 'Help Center', url: resolvedBaseUrl || '/' },
              { name: category.name, url: `${resolvedBaseUrl}/${category.slug}` },
              {
                name: article.title,
                url: `${resolvedBaseUrl}/${category.slug}/${article.slug}`,
              },
            ])}
          />
        </>
      )}

      <HelpCenterBreadcrumbs items={breadcrumbs} />

      <div className="mt-6 flex gap-8">
        <article className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold leading-tight">{article.title}</h1>

          <div className="mt-6 prose prose-neutral dark:prose-invert max-w-none">
            {article.contentJson && isRichTextContent(article.contentJson) ? (
              <RichTextContent content={article.contentJson as JSONContent} />
            ) : (
              <p className="whitespace-pre-wrap">{article.content}</p>
            )}
          </div>

          <HelpCenterArticleFeedback
            articleId={article.id}
            helpfulCount={article.helpfulCount}
            notHelpfulCount={article.notHelpfulCount}
          />

          <HelpCenterPrevNext categorySlug={categorySlug} prev={prev} next={next} />
        </article>

        <HelpCenterToc headings={headings} />
      </div>
    </div>
  )
}
