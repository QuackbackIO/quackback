import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScrollArea } from '@/components/ui/scroll-area'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
import type { ChangelogId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'
import { WidgetPortalTitle } from './widget-portal-title'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

interface WidgetChangelogDetailProps {
  entryId: string
}

export function WidgetChangelogDetail({ entryId }: WidgetChangelogDetailProps) {
  const { data: entry, isLoading } = useQuery(publicChangelogQueries.detail(entryId as ChangelogId))

  const changelogEntryId = entry?.id
  const handleViewOnPortal = useCallback(() => {
    if (!changelogEntryId) return
    const url = `${window.location.origin}/changelog/${changelogEntryId}`
    window.parent.postMessage({ type: 'quackback:navigate', url }, '*')
  }, [changelogEntryId])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!entry) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="text-sm text-muted-foreground">Entry not found</div>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="px-4 py-3">
        <time className="text-[11px] text-muted-foreground/60 uppercase tracking-wide">
          {formatDate(entry.publishedAt)}
        </time>
        <WidgetPortalTitle title={entry.title} onClick={handleViewOnPortal} />

        <div className="mt-3">
          {entry.contentJson && isRichTextContent(entry.contentJson) ? (
            <RichTextContent
              content={entry.contentJson as JSONContent}
              className="prose-sm [&_h1]:text-base [&_h2]:text-[15px] [&_h3]:text-sm [&_h4]:text-sm [&_p]:text-[13px] [&_li]:text-[13px]"
            />
          ) : (
            <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{entry.content}</p>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}
