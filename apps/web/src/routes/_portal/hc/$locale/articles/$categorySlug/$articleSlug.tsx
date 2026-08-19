import { createFileRoute, getRouteApi, notFound } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { getPublicArticleBySlugFn } from '@/lib/server/functions/help-center'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
import { EmbedHydration } from '@/components/shared/embed-hydration'
import { HelpCenterBreadcrumbs } from '@/components/help-center/help-center-breadcrumbs'
import { HelpCenterPrevNext } from '@/components/help-center/help-center-prev-next'
import { HelpCenterArticleFeedback } from '@/components/help-center/help-center-article-feedback'
import { HelpCenterToc } from '@/components/help-center/help-center-toc'
import { extractHeadings, computePrevNext } from '@/components/help-center/help-center-article-utils'
import { localizedHcPath } from '@/lib/shared/help-center-url'
import type { JSONContent } from '@tiptap/react'

const categoryApi = getRouteApi('/_portal/hc/$locale/articles/$categorySlug')

export const Route = createFileRoute('/_portal/hc/$locale/articles/$categorySlug/$articleSlug')({
  loader: async ({ params }) => {
    try {
      const article = await getPublicArticleBySlugFn({
        data: { slug: params.articleSlug, locale: params.locale },
      })
      return { article }
    } catch {
      throw notFound()
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { article } = loaderData
    return { meta: [{ title: article.title }, { name: 'description', content: article.description ?? '' }] }
  },
  component: LocaleArticleDetailPage,
})

function LocaleArticleDetailPage() {
  const { article } = Route.useLoaderData()
  const { locale, categorySlug } = Route.useParams()
  const { category, articles } = categoryApi.useLoaderData()

  const breadcrumbs = [
    { label: 'Help Center', href: localizedHcPath(locale, '/hc') },
    { label: category.name, href: localizedHcPath(locale, `/hc/categories/${category.slug}`) },
    { label: article.title },
  ]

  const headings = extractHeadings(article.contentJson)
  const { prev, next } = computePrevNext(articles, article.slug)

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="relative flex gap-8 xl:gap-12">
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

          {article.updatedAt && (
            <p className="mt-6 mb-8 text-sm text-muted-foreground">
              Last updated{' '}
              <span className="font-semibold text-foreground">
                {formatDistanceToNow(new Date(article.updatedAt), { addSuffix: true })}
              </span>
            </p>
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

          <HelpCenterArticleFeedback articleId={article.id} />

          <HelpCenterPrevNext categorySlug={categorySlug} prev={prev} next={next} locale={locale} />
        </article>

        <div className="hidden w-56 shrink-0 xl:block">
          <HelpCenterToc headings={headings} />
        </div>
      </div>
    </div>
  )
}
