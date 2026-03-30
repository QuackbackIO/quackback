import { Link } from '@tanstack/react-router'
import { LinkIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
import { StatusBadge } from '@/components/ui/status-badge'
import type { ChangelogId, PostId } from '@featurepool/ids'
import type { JSONContent } from '@tiptap/react'
import type { TiptapContent } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'

interface LinkedPost {
  id: PostId
  title: string
  voteCount: number
  boardSlug: string
  status?: {
    name: string
    color: string
  } | null
}

interface ChangelogEntryCardProps {
  id: ChangelogId
  title: string
  content: string
  contentJson: TiptapContent | null
  publishedAt: string
  linkedPosts: LinkedPost[]
  className?: string
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function ChangelogEntryCard({
  id,
  title,
  content,
  contentJson,
  publishedAt,
  linkedPosts,
  className,
}: ChangelogEntryCardProps) {
  return (
    <article className={cn('flex gap-8 lg:gap-16', className)}>
      {/* Date sidebar */}
      <div className="hidden md:block w-40 shrink-0 pt-1">
        <time dateTime={publishedAt} className="text-sm text-muted-foreground">
          {formatDate(publishedAt)}
        </time>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Mobile date */}
        <time dateTime={publishedAt} className="md:hidden text-sm text-muted-foreground mb-4 block">
          {formatDate(publishedAt)}
        </time>

        {/* Title with permalink */}
        <Link
          to="/changelog/$entryId"
          params={{ entryId: id }}
          className="group inline-flex items-center gap-2"
        >
          <h2 className="text-2xl font-bold group-hover:text-primary transition-colors">{title}</h2>
          <LinkIcon className="h-4 w-4 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </Link>

        {/* Rich content body */}
        <div className="mt-4">
          {contentJson && isRichTextContent(contentJson) ? (
            <RichTextContent content={contentJson as JSONContent} />
          ) : (
            <p className="whitespace-pre-wrap">{content}</p>
          )}
        </div>

        {/* Linked posts */}
        {linkedPosts.length > 0 && (
          <div className="mt-6 grid gap-2">
            {linkedPosts.map((post) => (
              <Link
                key={post.id}
                to="/b/$slug/posts/$postId"
                params={{ slug: post.boardSlug, postId: post.id }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/50 hover:border-border hover:bg-muted/30 transition-all group/post"
              >
                <div className="flex items-center gap-0.5 text-muted-foreground">
                  <ChevronUpIcon className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">{post.voteCount}</span>
                </div>
                <span className="flex-1 min-w-0 text-sm font-medium truncate group-hover/post:text-primary transition-colors">
                  {post.title}
                </span>
                {post.status && (
                  <StatusBadge
                    name={post.status.name}
                    color={post.status.color}
                    className="shrink-0"
                  />
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}
