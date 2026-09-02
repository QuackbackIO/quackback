import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { ScrollArea } from '@/components/ui/scroll-area'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-content'
import type { JSONContent } from '@tiptap/react'
import { WidgetPortalTitle } from './widget-portal-title'
import { WidgetArticleFooter } from './widget-article-footer'
import { sendToHost } from '@/lib/client/widget-bridge'
import { WidgetArticleSkeleton } from './widget-skeletons'

interface WidgetHelpDetailProps {
  articleSlug: string
  /** Tapping the category eyebrow browses the rest of that collection. */
  onCategorySelect?: (categoryId: string, categoryName: string) => void
  /** "Still stuck?" exit ramp — opens a new conversation. Omitted when the
   *  visitor can't start one (messenger off, or tickets-only). */
  onAskQuestion?: () => void
}

export function WidgetHelpDetail({
  articleSlug,
  onCategorySelect,
  onAskQuestion,
}: WidgetHelpDetailProps) {
  const { data: article, isLoading } = useQuery(publicHelpCenterQueries.articleBySlug(articleSlug))

  const handleViewOnPortal = useCallback(() => {
    if (!article) return
    const url = `${window.location.origin}/hc/articles/${article.category.slug}/${article.slug}`
    sendToHost({ type: 'quackback:navigate', url })
  }, [article])

  if (isLoading) {
    return <WidgetArticleSkeleton />
  }

  if (!article) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="text-sm text-muted-foreground">
          <FormattedMessage id="widget.helpDetail.notFound" defaultMessage="Article not found" />
        </div>
      </div>
    )
  }

  const eyebrowClass = 'text-[11px] text-muted-foreground/60 uppercase tracking-wide'

  return (
    <div className="flex flex-col h-full">
      <ScrollArea scrollBarClassName="w-1.5" className="flex-1 min-h-0">
        {/* Readable column when the host panel expands for long-form content. */}
        <div className="mx-auto w-full max-w-2xl px-4 py-3">
          {onCategorySelect ? (
            <button
              type="button"
              onClick={() => onCategorySelect(article.category.id, article.category.name)}
              className={`${eyebrowClass} -ms-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-muted/40 hover:text-muted-foreground`}
            >
              {article.category.name}
              <ChevronRightIcon className="size-3 rtl:rotate-180" aria-hidden />
              <span className="sr-only">
                <FormattedMessage
                  id="widget.helpDetail.browseCategory"
                  defaultMessage="Browse this collection"
                />
              </span>
            </button>
          ) : (
            <span className={eyebrowClass}>{article.category.name}</span>
          )}
          <WidgetPortalTitle title={article.title} onClick={handleViewOnPortal} />

          <div className="mt-3">
            {article.contentJson && isRichTextContent(article.contentJson) ? (
              <RichTextContent
                content={article.contentJson as JSONContent}
                className="prose-sm [&_h1]:text-base [&_h2]:text-[15px] [&_h3]:text-sm [&_h4]:text-sm [&_p]:text-[13px] [&_li]:text-[13px]"
              />
            ) : (
              <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">
                {article.content}
              </p>
            )}
          </div>

          <WidgetArticleFooter articleId={article.id} onAskQuestion={onAskQuestion} />
        </div>
      </ScrollArea>
    </div>
  )
}
