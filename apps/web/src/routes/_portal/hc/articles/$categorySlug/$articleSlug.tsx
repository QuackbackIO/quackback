import { createFileRoute, getRouteApi, notFound } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { getPublicArticleBySlugFn } from '@/lib/server/functions/help-center'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
import { EmbedHydration } from '@/components/shared/embed-hydration'
import { HelpCenterBreadcrumbs } from '@/components/help-center/help-center-breadcrumbs'
import { HelpCenterPrevNext } from '@/components/help-center/help-center-prev-next'
import { HelpCenterArticleFeedback } from '@/components/help-center/help-center-article-feedback'
import { HelpCenterToc } from '@/components/help-center/help-center-toc'
import { buildCategoryBreadcrumbs } from '@/components/help-center/help-center-utils'
import {
  extractHeadings,
  computePrevNext,
} from '@/components/help-center/help-center-article-utils'
import { JsonLd } from '@/components/json-ld'
import { buildArticleJsonLd, buildBreadcrumbJsonLd } from '@/lib/shared/json-ld'
import { stripMarkdownPreview } from '@/lib/shared/utils'
import type { JSONContent } from '@tiptap/react'

const helpCenterApi = getRouteApi('/_portal/hc')
const categoryApi = getRouteApi('/_portal/hc/articles/$categorySlug')

export const Route = createFileRoute('/_portal/hc/articles/$categorySlug/$articleSlug')({
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

    const portalMatch = matches.find((m) => (m.routeId as string) === '/_portal')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentLoaderData = portalMatch?.loaderData as Record<string, any> | undefined
    const workspaceName =
      (parentLoaderData?.org as Record<string, string> | undefined)?.name ?? 'Help Center'

    const description =
      article.description ||
      (article.content ? stripMarkdownPreview(article.content, 160) : undefined)
    const pageTitle = `${article.title} - ${workspaceName}`

    const baseUrl =
      ((portalMatch?.context as Record<string, unknown> | undefined)?.baseUrl as string) ?? ''
    const canonicalUrl = `${baseUrl}/hc/articles/${params.categorySlug}/${params.articleSlug}`

    return {
      meta: [
        { title: pageTitle },
        ...(description ? [{ name: 'description', content: description }] : []),
        { property: 'og:title', content: pageTitle },
        ...(description ? [{ property: 'og:description', content: description }] : []),
        { property: 'og:type', content: 'article' },
        { property: 'og:url', content: canonicalUrl },
        { property: 'og:site_name', content: workspaceName },
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: pageTitle },
        ...(description ? [{ name: 'twitter:description', content: description }] : []),
      ],
      links: [{ rel: 'canonical', href: canonicalUrl }],
    }
  },
  component: ArticleDetailPage,
})

function ArticleDetailPage() {
  const { article } = Route.useLoaderData()
  const { categorySlug } = Route.useParams()
  const { category, articles, allCategories } = categoryApi.useLoaderData()
  const { helpCenterConfig } = helpCenterApi.useLoaderData()
  const { baseUrl, settings } = Route.useRouteContext()
  const supportEnabled =
    !!settings?.featureFlags?.supportInbox && !!settings?.portalConfig?.support?.enabled

  const breadcrumbs = buildCategoryBreadcrumbs({
    allCategories,
    categoryId: category.id,
    articleTitle: article.title,
  })

  const headings = extractHeadings(article.contentJson)
  const { prev, next } = computePrevNext(articles, article.slug)

  const seoEnabled = helpCenterConfig?.seo?.structuredDataEnabled !== false
  const resolvedBaseUrl = baseUrl ?? ''

  return (
    <>
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
              {
                name: category.name,
                url: `${resolvedBaseUrl}/hc/categories/${category.slug}`,
              },
              {
                name: article.title,
                url: `${resolvedBaseUrl}/hc/articles/${category.slug}/${article.slug}`,
              },
            ])}
          />
        </>
      )}

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative flex justify-center gap-8 xl:gap-12">
          {/* Article */}
          <article className="min-w-0 max-w-2xl flex-1 py-10">
            <HelpCenterBreadcrumbs items={breadcrumbs.slice(0, -1)} />

            <h1 className="mt-6 text-3xl sm:text-4xl font-bold leading-tight tracking-tight">
              {article.title}
            </h1>

            {article.description && (
              <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
                {article.description}
              </p>
            )}

            {(article.author || article.updatedAt) && (
              <div className="mt-6 mb-8 flex items-center gap-3">
                {article.author?.avatarUrl ? (
                  <img
                    src={article.author.avatarUrl}
                    alt={article.author.name}
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <span className="w-10 h-10 rounded-full bg-muted border border-border flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">
                    {article.author?.name.charAt(0).toUpperCase() ?? '?'}
                  </span>
                )}
                <div className="flex flex-col gap-0.5">
                  {article.author && (
                    <span className="text-sm text-muted-foreground">
                      Written By{' '}
                      <span className="font-semibold text-foreground">{article.author.name}</span>
                    </span>
                  )}
                  {article.updatedAt && (
                    <span className="text-sm text-muted-foreground">
                      Last updated{' '}
                      <span className="font-semibold text-foreground">
                        {formatDistanceToNow(new Date(article.updatedAt), { addSuffix: true })}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="prose prose-neutral dark:prose-invert max-w-none">
              {article.contentJson && isRichTextContent(article.contentJson) ? (
                <EmbedHydration>
                  <RichTextContent content={article.contentJson as JSONContent} />
                </EmbedHydration>
              ) : (
                <p className="whitespace-pre-wrap">{article.content}</p>
              )}
            </div>

            <HelpCenterArticleFeedback
              articleId={article.id}
              supportHref={supportEnabled ? '/support/new' : null}
            />

            <HelpCenterPrevNext categorySlug={categorySlug} prev={prev} next={next} />
          </article>

          {/* Right: table of contents (scrollspy) */}
          <div className="hidden w-56 shrink-0 xl:block">
            <HelpCenterToc headings={headings} />
          </div>
        </div>
      </div>
    </>
  )
}
