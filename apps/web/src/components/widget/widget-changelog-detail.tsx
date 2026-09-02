import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { ScrollArea } from '@/components/ui/scroll-area'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-content'
import { EmbedHydration } from '@/components/shared/embed-hydration'
import type { ChangelogId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'
import { WidgetPortalTitle } from './widget-portal-title'
import { sendToHost } from '@/lib/client/widget-bridge'
import { WidgetArticleSkeleton } from './widget-skeletons'
import { ChangelogMetaRow } from './widget-changelog-meta'

interface WidgetChangelogDetailProps {
  entryId: string
}

export function WidgetChangelogDetail({ entryId }: WidgetChangelogDetailProps) {
  const { data: entry, isLoading } = useQuery(publicChangelogQueries.detail(entryId as ChangelogId))

  const changelogEntryId = entry?.id
  const handleViewOnPortal = useCallback(() => {
    if (!changelogEntryId) return
    const url = `${window.location.origin}/changelog/${changelogEntryId}`
    sendToHost({ type: 'quackback:navigate', url })
  }, [changelogEntryId])

  if (isLoading) {
    return <WidgetArticleSkeleton />
  }

  if (!entry) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="text-sm text-muted-foreground">
          <FormattedMessage id="widget.changelogDetail.notFound" defaultMessage="Entry not found" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea scrollBarClassName="w-1.5" className="flex-1 min-h-0">
        {/* Readable column when the host panel expands for long-form content. */}
        <div className="mx-auto w-full max-w-2xl px-4 py-3">
          {/* Same meta strip as the list card, so the push doesn't reshuffle
              date and chips around the title. */}
          <ChangelogMetaRow publishedAt={entry.publishedAt} categories={entry.categories} long />
          <WidgetPortalTitle title={entry.title} onClick={handleViewOnPortal} />

          <div className="mt-3">
            {entry.contentJson && isRichTextContent(entry.contentJson) ? (
              <EmbedHydration>
                <RichTextContent
                  content={entry.contentJson as JSONContent}
                  className="prose-sm [&_h1]:text-base [&_h2]:text-[15px] [&_h3]:text-sm [&_h4]:text-sm [&_p]:text-[13px] [&_li]:text-[13px]"
                />
              </EmbedHydration>
            ) : (
              <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">
                {entry.content}
              </p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
