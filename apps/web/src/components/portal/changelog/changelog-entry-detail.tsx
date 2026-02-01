'use client'

import { Link } from '@tanstack/react-router'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
import { StatusBadge } from '@/components/ui/status-badge'
import { BackLink } from '@/components/ui/back-link'
import { CalendarIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import type { ChangelogId, PostId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'
import type { TiptapContent } from '@quackback/db/types'

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

export function ChangelogEntryDetail({
  title,
  content,
  contentJson,
  publishedAt,
  linkedPosts,
}: ChangelogEntryDetailProps) {
  const formattedDate = new Date(publishedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <article>
      {/* Back link */}
      <BackLink to="/changelog" className="mb-6">
        Changelog
      </BackLink>

      {/* Header */}
      <header className="mb-8">
        {/* Date */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
          <CalendarIcon className="h-4 w-4" />
          <time dateTime={publishedAt}>{formattedDate}</time>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold">{title}</h1>
      </header>

      {/* Content */}
      <div className="prose prose-neutral dark:prose-invert max-w-none mb-8">
        {contentJson && isRichTextContent(contentJson) ? (
          <RichTextContent content={contentJson as JSONContent} />
        ) : (
          <p className="whitespace-pre-wrap">{content}</p>
        )}
      </div>

      {/* Linked posts section */}
      {linkedPosts.length > 0 && (
        <section className="border-t pt-8">
          <h2 className="text-lg font-semibold mb-4">Shipped Features</h2>
          <div className="grid gap-3">
            {linkedPosts.map((post) => (
              <Link
                key={post.id}
                to="/b/$slug/posts/$postId"
                params={{ slug: post.boardSlug, postId: post.id }}
                className="flex items-center gap-4 p-4 rounded-lg border border-border/50 hover:border-border hover:bg-muted/30 transition-all group"
              >
                <div className="flex items-center gap-1 text-muted-foreground">
                  <ChevronUpIcon className="h-4 w-4" />
                  <span className="text-sm font-medium">{post.voteCount}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium group-hover:text-primary transition-colors">
                    {post.title}
                  </span>
                </div>
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
    </article>
  )
}
