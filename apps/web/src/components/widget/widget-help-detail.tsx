import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScrollArea } from '@/components/ui/scroll-area'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
import type { JSONContent } from '@tiptap/react'
import { WidgetPortalTitle } from './widget-portal-title'

interface WidgetHelpDetailProps {
  articleSlug: string
}

export function WidgetHelpDetail({ articleSlug }: WidgetHelpDetailProps) {
  const { data: article, isLoading } = useQuery(publicHelpCenterQueries.articleBySlug(articleSlug))

  const handleViewOnPortal = useCallback(() => {
    if (!article) return
    const url = `${window.location.origin}/help/${article.category.slug}/${article.slug}`
    window.parent.postMessage({ type: 'quackback:navigate', url }, '*')
  }, [article])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!article) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="text-sm text-muted-foreground">Article not found</div>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="px-4 py-3">
        <span className="text-[11px] text-muted-foreground/60 uppercase tracking-wide">
          {article.category.name}
        </span>
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
      </div>
    </ScrollArea>
  )
}
