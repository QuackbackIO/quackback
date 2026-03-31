import { Link } from '@tanstack/react-router'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
import { StatusBadge } from '@/components/ui/status-badge'
import { BackLink } from '@/components/ui/back-link'
import { ChevronUpIcon } from '@heroicons/react/24/outline'
import type { ChangelogId, PostId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'
import type { TiptapContent } from '@/lib/shared/db-types'

interface LinkedPost {
  id: PostId
  title: string
  voteCount: number
  boardSlug: string
  status: {
    name: string
    color: string
  } | null
}

interface ChangelogEntryDetailProps {
  id: ChangelogId
  title: string
  content: string
  contentJson: TiptapContent | null
  publishedAt: string
  linkedPosts: LinkedPost[]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function ChangelogEntryDetail({
  title,
  content,
  contentJson,
  publishedAt,
  linkedPosts,
}: ChangelogEntryDetailProps) {
  return (
    <article>
      {/* Back link */}
      <BackLink to="/changelog" className="mb-8">
        Changelog
      </BackLink>

      <div className="flex gap-8 lg:gap-16">
        {/* Date sidebar */}
        <div className="hidden md:block w-40 shrink-0 pt-1">
          <time dateTime={publishedAt} className="text-sm text-muted-foreground">
            {formatDate(publishedAt)}
          </time>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Mobile date */}
          <time
            dateTime={publishedAt}
            className="md:hidden text-sm text-muted-foreground mb-4 block"
          >
            {formatDate(publishedAt)}
          </time>

          {/* Title */}
          <h1 className="text-3xl font-bold leading-tight">{title}</h1>

          {/* Rich content body */}
          <div className="mt-6">
            {contentJson && isRichTextContent(contentJson) ? (
              <RichTextContent content={contentJson as JSONContent} />
            ) : (
              <p className="whitespace-pre-wrap">{content}</p>
            )}
          </div>

          {/* Linked posts */}
          {linkedPosts.length > 0 && (
            <section className="mt-8 pt-8 border-t border-border/40">
              <h2 className="text-lg font-semibold mb-4">Shipped Features</h2>
              <div className="grid gap-2">
                {linkedPosts.map((post) => (
                  <Link
                    key={post.id}
                    to="/b/$slug/posts/$postId"
                    params={{ slug: post.boardSlug, postId: post.id }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/50 hover:border-border hover:bg-muted/30 transition-all group"
                  >
                    <div className="flex items-center gap-0.5 text-muted-foreground">
                      <ChevronUpIcon className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">{post.voteCount}</span>
                    </div>
                    <span className="flex-1 min-w-0 text-sm font-medium truncate group-hover:text-primary transition-colors">
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
            </section>
          )}
        </div>
      </div>
    </article>
  )
}
