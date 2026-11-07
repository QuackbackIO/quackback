import { Link } from '@tanstack/react-router'
import { LinkIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-content'
import { StatusBadge } from '@/components/ui/status-badge'
import { TAG_TINT, useTagStyle } from '@/components/public/tag-tint'
import { LocalDate } from '@/components/ui/local-date'
import type { ChangelogId, PostId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'
import type { TiptapContent } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'
import { contentPreview } from '@/lib/shared/utils/string'
import type { PageChoices } from '@/lib/shared/design/page-choices'

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

interface CategoryBadge {
  id: string
  name: string
  color: string
}

interface ChangelogEntryCardProps {
  id: ChangelogId
  title: string
  content: string
  contentJson: TiptapContent | null
  publishedAt: string
  linkedPosts: LinkedPost[]
  categories?: CategoryBadge[]
  className?: string
  /** How the entry sits: dates in a column beside it, on a card, or as a line. */
  layout?: ChangelogEntries
  /** The entry's featured image, and how it shows; none leaves it off. */
  featuredImageUrl?: string | null
  image?: EntryImage
}

type ChangelogEntries = PageChoices['changelog']['entries']
type EntryImage = PageChoices['changelog']['images']

/** The entry's date, e.g. "October 1, 2026", in the reader's zone once hydrated. */
const ENTRY_DATE: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }

export function ChangelogEntryCard({
  id,
  title,
  content,
  contentJson,
  publishedAt,
  linkedPosts,
  categories = [],
  className,
  layout = 'timeline',
  featuredImageUrl = null,
  image = 'none',
}: ChangelogEntryCardProps) {
  const tagStyle = useTagStyle()
  const shown = image === 'none' ? null : featuredImageUrl
  const labels = categories.length > 0 && (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {categories.map((category) => (
        <span
          key={category.id}
          data-qb-part="tag"
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            TAG_TINT
          )}
          style={tagStyle(category.color)}
        >
          {category.name}
        </span>
      ))}
    </div>
  )
  const wide = shown && image === 'wide' && (
    <img
      src={shown}
      alt=""
      loading="lazy"
      className="mt-4 w-full rounded-xl border border-border/40 object-cover aspect-[2/1]"
    />
  )
  const thumbnail = shown && image === 'thumbnail' && (
    <img
      src={shown}
      alt=""
      loading="lazy"
      className="size-20 shrink-0 rounded-lg border border-border/40 object-cover"
    />
  )
  const heading = (size: string) => (
    <Link
      to="/changelog/$entryId"
      params={{ entryId: id }}
      className="group inline-flex items-center gap-2"
    >
      <h2
        data-qb-part="section-heading"
        className={cn(size, 'group-hover:text-primary transition-colors')}
      >
        {title}
      </h2>
      <LinkIcon className="h-4 w-4 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </Link>
  )
  if (layout === 'compact')
    return (
      <article className={cn('flex items-start gap-4 sm:gap-8', className)}>
        <LocalDate
          date={publishedAt}
          options={ENTRY_DATE}
          className="hidden sm:block w-36 shrink-0 pt-0.5 text-sm text-muted-foreground"
        />
        <div className="flex-1 min-w-0">
          <LocalDate
            date={publishedAt}
            options={ENTRY_DATE}
            className="sm:hidden mb-1 block text-xs text-muted-foreground"
          />
          {labels}
          {heading('text-base font-semibold')}
          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
            {contentPreview(content, 240)}
          </p>
          {wide}
        </div>
        {thumbnail}
      </article>
    )
  if (layout === 'cards')
    return (
      <article
        data-qb-surface="card"
        className={cn('rounded-2xl border border-border bg-card p-6 sm:p-8', className)}
      >
        <div className="flex items-start gap-6">
          <div className="flex-1 min-w-0">
            <LocalDate
              date={publishedAt}
              options={ENTRY_DATE}
              className="mb-3 block text-sm text-muted-foreground"
            />
            {labels}
            {heading('text-2xl font-bold')}
            {wide}
            <EntryBody content={content} contentJson={contentJson} />
            <LinkedPosts posts={linkedPosts} />
          </div>
          {thumbnail}
        </div>
      </article>
    )
  return (
    <article className={cn('flex gap-8 lg:gap-16', className)}>
      {/* Date sidebar */}
      <div className="hidden md:block w-40 shrink-0 pt-1">
        <LocalDate
          date={publishedAt}
          options={ENTRY_DATE}
          className="text-sm text-muted-foreground"
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Mobile date */}
        <LocalDate
          date={publishedAt}
          options={ENTRY_DATE}
          className="md:hidden text-sm text-muted-foreground mb-4 block"
        />

        {/* Category labels */}
        {labels}

        {/* Title with permalink */}
        {heading('text-2xl font-bold')}
        {wide}

        <EntryBody content={content} contentJson={contentJson} />
        <LinkedPosts posts={linkedPosts} />
      </div>
      {thumbnail}
    </article>
  )
}

/** The entry's own words. */
function EntryBody({
  content,
  contentJson,
}: Pick<ChangelogEntryCardProps, 'content' | 'contentJson'>) {
  return (
    <div className="mt-4">
      {contentJson && isRichTextContent(contentJson) ? (
        <RichTextContent content={contentJson as JSONContent} />
      ) : (
        <p className="whitespace-pre-wrap">{content}</p>
      )}
    </div>
  )
}

/** The posts an entry shipped, each with its votes and status. */
function LinkedPosts({ posts }: { posts: LinkedPost[] }) {
  if (posts.length === 0) return null
  return (
    <div className="mt-6 grid gap-2">
      {posts.map((post) => (
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
            <StatusBadge name={post.status.name} color={post.status.color} className="shrink-0" />
          )}
        </Link>
      ))}
    </div>
  )
}
