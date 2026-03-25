'use client'

import { useQuery } from '@tanstack/react-query'
import { ScrollArea } from '@/components/ui/scroll-area'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
import type { ChangelogId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'

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
        <time className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">
          {formatDate(entry.publishedAt)}
        </time>
        <h2 className="text-lg font-bold text-foreground mt-1 leading-snug">{entry.title}</h2>

        <div className="mt-3 text-sm prose-widget">
          {entry.contentJson && isRichTextContent(entry.contentJson) ? (
            <RichTextContent content={entry.contentJson as JSONContent} />
          ) : (
            <p className="whitespace-pre-wrap text-muted-foreground">{entry.content}</p>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}
