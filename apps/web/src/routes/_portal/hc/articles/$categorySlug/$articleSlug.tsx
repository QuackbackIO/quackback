import { createFileRoute, getRouteApi, notFound, Link } from '@tanstack/react-router'
import { ArrowLeft, FileText } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatDistanceToNow } from 'date-fns'
import { getPublicArticleBySlugFn } from '@/lib/server/functions/help-center'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
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
import { cn, stripMarkdownPreview } from '@/lib/shared/utils'
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
  const { baseUrl } = Route.useRouteContext()

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

      <div className="px-4 sm:px-6 md:px-8">
        <div className="relative flex justify-center gap-8 xl:gap-12">
          {/* Left: articles in this category */}
          {articles.length > 1 && (
            <div className="hidden w-60 shrink-0 xl:block">
              <aside className="sticky top-14 h-[calc(100vh-3.5rem)] hidden flex-col py-8 pl-4 pr-2 xl:flex">
                <Link
                  to={`/hc/categories/${categorySlug}` as '/hc'}
                  className="mb-5 shrink-0 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
                >
                  <ArrowLeft className="h-4 w-4 shrink-0" />
                  <span className="truncate">All {category.name}</span>
                </Link>
                <h4 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  In this category
                </h4>
                <ScrollArea className="min-h-0 flex-1" scrollBarClassName="w-1.5">
                  <ul className="space-y-0.5 overflow-x-hidden pr-2">
                    {articles.map((a) => (
                      <li key={a.id}>
                        <Link
                          to={`/hc/articles/${categorySlug}/${a.slug}` as '/hc'}
                          className={cn(
                            'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-[13px] leading-snug transition-colors',
                            a.slug === article.slug
                              ? 'bg-secondary text-foreground font-medium'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                          )}
                        >
                          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                          <span>{a.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </aside>
            </div>
          )}

          {/* Center: article */}
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
                <RichTextContent content={article.contentJson as JSONContent} />
              ) : (
                <p className="whitespace-pre-wrap">{article.content}</p>
              )}
            </div>

            <HelpCenterArticleFeedback articleId={article.id} />

            <HelpCenterPrevNext categorySlug={categorySlug} prev={prev} next={next} />
          </article>

          {/* Right: table of contents — always rendered to preserve layout balance */}
          <div className="hidden w-56 shrink-0 xl:block">
            <HelpCenterToc headings={headings} />
          </div>
        </div>
      </div>
    </>
  )
}
