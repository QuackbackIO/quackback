import type { CSSProperties, ReactNode } from 'react'
import { FormattedMessage } from 'react-intl'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/shared/utils'
import { ConversationThreadSkeleton } from '@/components/shared/conversation/conversation-thread-skeleton'

/**
 * Loading placeholders for every widget surface. Each skeleton reproduces the
 * measured box model of the view it stands in for — same paddings, gaps, row
 * heights and line boxes — so the swap to real content is a fade, never a
 * reflow. Only elements the view ALWAYS renders get a placeholder; optional
 * chrome (category chips, a comment composer the board may not allow) is
 * left out rather than reserving space that may vanish.
 *
 * Every skeleton is also the Suspense fallback for its lazy view chunk, so a
 * cold-cache tab click shows one continuous placeholder from chunk fetch
 * through data fetch.
 *
 * Line-box metrics (Chromium, widget root 16px/24px):
 *   text-[11px] eyebrow in a list row ........ 16.5px  (inherits 1.5)
 *   text-[11px] eyebrow inline in a detail .. 24px    (strut of the 16px block)
 *   text-xs ................................. 16px    · leading-relaxed 19.5px
 *   text-sm ................................. 20px    · leading-snug 19.25px
 *   15px title inline in its portal button .. 24px per line
 *   13px detail body (prose-sm) ............. 22.29px per line, 14.86px between ¶
 */

// ── Primitives ──

/**
 * Accessible wrapper: announces once, fades in, honors reduced motion. Only
 * the fade is handled here — CSS animations don't inherit, so each `Skeleton`
 * turns off its own pulse under `prefers-reduced-motion`.
 */
function SkeletonRegion({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn('animate-in fade-in duration-200 motion-reduce:animate-none', className)}
    >
      <span className="sr-only">
        <FormattedMessage id="widget.loading" defaultMessage="Loading…" />
      </span>
      {children}
    </div>
  )
}

/**
 * Opacity ramp so lower rows recede (1 → 0.55 across the list). Kept gentle:
 * it multiplies with `animate-pulse`'s 50% dip, so anything steeper makes the
 * last rows blink out entirely on a white panel.
 */
function rowFade(index: number, count: number): CSSProperties {
  return { opacity: count <= 1 ? 1 : 1 - (0.45 * index) / (count - 1) }
}

type LineSize =
  'eyebrow' | 'eyebrow-inline' | 'xs' | 'xs-relaxed' | 'body' | 'sm' | 'sm-snug' | 'title'

const LINE_BOX: Record<LineSize, string> = {
  eyebrow: 'h-[16.5px]',
  'eyebrow-inline': 'h-6',
  xs: 'h-4',
  'xs-relaxed': 'h-[19.5px]',
  // text-[13px] leading-relaxed (post body)
  body: 'h-[21.125px]',
  sm: 'h-5',
  'sm-snug': 'h-[19.25px]',
  title: 'h-6',
}

const LINE_BAR: Record<LineSize, string> = {
  eyebrow: 'h-2',
  'eyebrow-inline': 'h-2',
  xs: 'h-2.5',
  'xs-relaxed': 'h-2.5',
  body: 'h-2.5',
  sm: 'h-3',
  'sm-snug': 'h-3',
  title: 'h-3.5',
}

/**
 * A text-line placeholder that occupies exactly the line box of the text it
 * replaces (see the metrics table above), with a thinner bar centered in it.
 */
function Line({
  size,
  width = 'w-full',
  className,
}: {
  size: LineSize
  width?: string
  className?: string
}) {
  return (
    <div className={cn('flex items-center', LINE_BOX[size], className)}>
      <Skeleton className={cn(LINE_BAR[size], width)} />
    </div>
  )
}

/** Mirrors WidgetVoteButton: 48×56 stacked, or the compact horizontal pill. */
function VoteButtonSkeleton({ compact }: { compact?: boolean }) {
  return (
    <Skeleton
      className={cn(
        'shrink-0 rounded-md border border-border/30 bg-muted/40',
        compact ? 'h-7 w-11' : 'h-14 w-12'
      )}
    />
  )
}

// ── Feedback (ideas list) ──

const POST_TITLE_WIDTHS = ['w-4/5', 'w-3/5', 'w-11/12', 'w-2/3', 'w-3/4', 'w-1/2']

/**
 * Mirrors WidgetPostRow (68px): vote button + status/board eyebrow + title.
 * Eyebrow chips are two short bars (status dot+name, board icon+name).
 */
export function WidgetPostRowSkeleton({
  compact,
  style,
  titleWidth = 'w-3/4',
}: {
  compact?: boolean
  style?: CSSProperties
  titleWidth?: string
}) {
  return (
    <div
      className={cn(
        'flex w-full items-center gap-2 rounded-lg',
        compact ? 'px-1.5 py-1' : 'px-2 py-1.5'
      )}
      style={style}
    >
      <VoteButtonSkeleton compact={compact} />
      <div className="min-w-0 flex-1">
        <div className="flex h-[16.5px] items-center gap-1.5">
          <Skeleton className="h-2 w-10" />
          {!compact && <Skeleton className="h-2 w-16" />}
        </div>
        <Line size={compact ? 'xs' : 'sm'} width={titleWidth} />
      </div>
    </div>
  )
}

/** The popular-ideas / search-results column on the Feedback tab. */
export function WidgetPostListSkeleton({
  count = 6,
  compact,
  fade = true,
  className,
}: {
  count?: number
  compact?: boolean
  fade?: boolean
  className?: string
}) {
  return (
    <SkeletonRegion className={cn('space-y-0.5', className)}>
      {Array.from({ length: count }, (_, i) => (
        <WidgetPostRowSkeleton
          key={i}
          compact={compact}
          titleWidth={POST_TITLE_WIDTHS[i % POST_TITLE_WIDTHS.length]}
          style={fade ? rowFade(i, count) : undefined}
        />
      ))}
    </SkeletonRegion>
  )
}

// ── Post detail ──

/**
 * Mirrors one root comment in WidgetCommentList (81.5px): the py-1.5 well,
 * avatar+name+time header, one relaxed text-xs body line, the reply row.
 */
function CommentSkeleton({ style }: { style?: CSSProperties }) {
  return (
    <div className="py-1.5" style={style}>
      <div className="flex h-5 items-center gap-1.5">
        <Skeleton className="size-5 shrink-0 rounded-full" />
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-2 w-16" />
      </div>
      <Line size="xs-relaxed" className="ms-7 mt-1" width="w-4/5" />
      <div className="ms-7 mt-1.5 flex h-5 items-center gap-1">
        <Skeleton className="size-3.5 rounded-full" />
        <Skeleton className="h-2 w-8" />
      </div>
    </div>
  )
}

/**
 * Mirrors WidgetPostDetail: the 63px vote/title header, a two-line body, then
 * the comments section with its count line and first comments. The comment
 * composer is deliberately absent — whether it renders depends on the board's
 * per-actor comment tier, which is only known once the post arrives.
 */
export function WidgetPostDetailSkeleton() {
  return (
    <SkeletonRegion className="mx-auto w-full max-w-2xl space-y-3 px-3 pt-3 pb-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <VoteButtonSkeleton />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex h-[16.5px] items-center gap-1">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-2 w-10" />
          </div>
          <Line size="title" className="mt-0.5" width="w-3/4" />
          <div className="mt-1 flex h-[16.5px] items-center gap-1.5">
            <Skeleton className="h-2 w-16" />
            <Skeleton className="h-2 w-14" />
            <Skeleton className="h-2 w-16" />
          </div>
        </div>
      </div>

      <div>
        <Line size="body" width="w-full" />
        <Line size="body" width="w-2/3" />
      </div>

      <div className="border-t border-border/50 pt-3">
        <div className="mb-3 flex h-4 items-center gap-1.5">
          <Skeleton className="size-3.5 rounded-sm" />
          <Skeleton className="h-2.5 w-20" />
        </div>
        <div className="space-y-3">
          <CommentSkeleton style={rowFade(0, 4)} />
          <CommentSkeleton style={rowFade(1, 4)} />
          <CommentSkeleton style={rowFade(2, 4)} />
          <CommentSkeleton style={rowFade(3, 4)} />
        </div>
      </div>
    </SkeletonRegion>
  )
}

// ── Changelog ──

/** Mirrors one changelog card (108.75px): date eyebrow, title, 2 preview lines. */
function ChangelogCardSkeleton({
  titleWidth = 'w-3/4',
  style,
}: {
  titleWidth?: string
  style?: CSSProperties
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card px-3.5 py-3" style={style}>
      <div className="mb-1 flex h-[16.5px] items-center">
        <Skeleton className="h-2 w-[70px]" />
      </div>
      <Line size="sm-snug" width={titleWidth} />
      <div className="mt-1">
        <Line size="xs-relaxed" width="w-full" />
        <Line size="xs-relaxed" width="w-11/12" />
      </div>
    </div>
  )
}

const CHANGELOG_TITLE_WIDTHS = ['w-3/4', 'w-1/2', 'w-4/5', 'w-3/5', 'w-2/3']

/**
 * Mirrors the Changelog tab: "Latest / From {team}" header, then the card
 * column. The category filter chips only appear once entries are known to
 * carry categories, so they get no placeholder.
 */
export function WidgetChangelogListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonRegion className="px-3 pt-2 pb-3">
      <header className="px-1 pb-2">
        <div className="flex h-6 items-center">
          <Skeleton className="h-4 w-16" />
        </div>
        <Line size="xs" width="w-24" />
      </header>
      <div className="space-y-2">
        {Array.from({ length: count }, (_, i) => (
          <ChangelogCardSkeleton
            key={i}
            titleWidth={CHANGELOG_TITLE_WIDTHS[i % CHANGELOG_TITLE_WIDTHS.length]}
            style={rowFade(i, count)}
          />
        ))}
      </div>
    </SkeletonRegion>
  )
}

/** Appended below the last loaded page while the next one streams in. */
export function WidgetChangelogMoreSkeleton() {
  return (
    <SkeletonRegion className="space-y-2 pt-2">
      <ChangelogCardSkeleton titleWidth="w-3/4" style={{ opacity: 0.7 }} />
      <ChangelogCardSkeleton titleWidth="w-1/2" style={{ opacity: 0.4 }} />
    </SkeletonRegion>
  )
}

// ── Long-form reading views (changelog entry, help article) ──

/** One prose paragraph: `lines` × 22.29px, followed by the prose-sm ¶ gap. */
function ParagraphSkeleton({
  lines,
  lastWidth,
  style,
}: {
  lines: number
  lastWidth: string
  style?: CSSProperties
}) {
  return (
    <div className="mb-[14.857px]" style={style}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="flex h-[22.286px] items-center">
          <Skeleton className={cn('h-2.5', i === lines - 1 ? lastWidth : 'w-full')} />
        </div>
      ))}
    </div>
  )
}

/**
 * Mirrors WidgetChangelogDetail / WidgetHelpDetail: the inline eyebrow line
 * (24px), the portal-linked title (mt-0.5, 24px), then prose paragraphs
 * starting mt-3. Category chips are conditional and get no placeholder.
 */
export function WidgetArticleSkeleton() {
  return (
    <SkeletonRegion className="mx-auto w-full max-w-2xl px-4 py-3">
      <Line size="eyebrow-inline" width="w-24" />
      <Line size="title" className="mt-0.5" width="w-3/5" />
      <div className="mt-3">
        <ParagraphSkeleton lines={3} lastWidth="w-4/5" style={rowFade(0, 3)} />
        <ParagraphSkeleton lines={4} lastWidth="w-2/3" style={rowFade(1, 3)} />
        <ParagraphSkeleton lines={2} lastWidth="w-3/4" style={rowFade(2, 3)} />
      </div>
    </SkeletonRegion>
  )
}

// ── Help center ──

/**
 * Mirrors a top-level collection row: icon, name, optional description
 * (two relaxed text-xs lines), article count, chevron. 69.5px without a
 * description, 110.5px with one.
 */
function HelpCollectionRowSkeleton({
  description,
  style,
}: {
  description: boolean
  style?: CSSProperties
}) {
  return (
    <li className="border-b border-border/40 last:border-b-0" style={style}>
      <div className="flex w-full items-center gap-3 rounded-lg px-2 py-3.5">
        <Skeleton className="size-6 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <Line size="sm" width="w-2/5" />
          {description && (
            <div className="mt-0.5">
              <Line size="xs-relaxed" width="w-11/12" />
              <Line size="xs-relaxed" width="w-1/2" />
            </div>
          )}
          <Line size="eyebrow" className="mt-1" width="w-14" />
        </div>
        <Skeleton className="size-4 shrink-0 rounded-sm" />
      </div>
    </li>
  )
}

/** The Help tab's default view: "{n} collections" heading + collection rows. */
export function WidgetHelpCollectionsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonRegion>
      <div className="flex h-8 items-center px-1 pt-2 pb-1">
        <Skeleton className="h-3 w-24" />
      </div>
      <ul>
        {Array.from({ length: count }, (_, i) => (
          <HelpCollectionRowSkeleton key={i} description={i !== 0} style={rowFade(i, count)} />
        ))}
      </ul>
    </SkeletonRegion>
  )
}

/**
 * Whole-view fallback for the Help tab chunk: the search field shell (same
 * 38px box as the real input) above the collections list.
 */
export function WidgetHelpViewSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 pt-2 pb-1">
        <Skeleton className="h-[38px] w-full rounded-lg border border-border/30 bg-muted/30" />
      </div>
      <div className="px-3 pt-1 pb-3">
        <WidgetHelpCollectionsSkeleton />
      </div>
    </div>
  )
}

/**
 * Whole-view fallback for the Help category chunk. The name is already known
 * (it came from the tapped row) so the header renders for real; the icon is a
 * placeholder because CategoryIcon lives in the lazy chunk being fetched.
 */
export function WidgetHelpCategoryViewSkeleton({
  categoryName,
  hasIcon,
}: {
  categoryName: string
  hasIcon: boolean
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border/30 px-3 pt-2 pb-2">
        <div className="flex items-center gap-2">
          {hasIcon && <Skeleton className="size-5 shrink-0 rounded-md" />}
          <h3 className="text-sm font-semibold text-foreground">{categoryName}</h3>
        </div>
      </div>
      <div className="px-3 pt-1 pb-3">
        <WidgetHelpArticleListSkeleton />
      </div>
    </div>
  )
}

/**
 * Mirrors a category's article row: snug title, description (two relaxed
 * text-xs lines), chevron — 80.25px. Every other row uses a one-line
 * description (60.75px) to break the rhythm.
 */
export function WidgetHelpArticleListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonRegion className="space-y-0.5">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5"
          style={rowFade(i, count)}
        >
          <div className="min-w-0 flex-1">
            <Line size="sm-snug" width={i % 2 ? 'w-3/5' : 'w-4/5'} />
            <div className="mt-0.5">
              <Line size="xs-relaxed" width="w-full" />
              {i % 3 !== 2 && <Line size="xs-relaxed" width="w-1/2" />}
            </div>
          </div>
          <Skeleton className="size-3.5 shrink-0 rounded-sm" />
        </div>
      ))}
    </SkeletonRegion>
  )
}

/** Mirrors a search hit (100.75px): category eyebrow, title, two preview lines. */
export function WidgetHelpSearchSkeleton({ count = 4 }: { count?: number }) {
  return (
    <SkeletonRegion className="space-y-1">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg px-2.5 py-2.5" style={rowFade(i, count)}>
          <div className="mb-0.5 flex h-[16.5px] items-center">
            <Skeleton className="h-2 w-16" />
          </div>
          <Line size="sm-snug" width={i % 2 ? 'w-2/3' : 'w-5/6'} />
          <div className="mt-1">
            <Line size="xs-relaxed" width="w-full" />
            <Line size="xs-relaxed" width="w-3/4" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}

// ── Messages / Tickets ──

/** Mirrors StageChip + ticket reference (20.5px: py-0.5 around a 16.5px line). */
function StageChipRowSkeleton() {
  return (
    <div className="mt-1 flex h-[20.5px] items-center gap-1.5">
      <Skeleton className="h-[20.5px] w-[63px] rounded-full" />
      <Skeleton className="h-2 w-7" />
    </div>
  )
}

/**
 * Mirrors a Messages row: 36px avatar, name + time (20px), preview (16px) —
 * 61px; every third row is ticket-linked and adds the stage chip row (85.5px),
 * matching how the real list mixes chats and ticket threads.
 */
export function WidgetConversationListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonRegion>
      <ul className="px-3 pt-1 pb-24">
        {Array.from({ length: count }, (_, i) => (
          <li
            key={i}
            className="border-b border-border/40 last:border-b-0"
            style={rowFade(i, count)}
          >
            <div className="flex w-full items-center gap-3 rounded-lg px-2 py-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex h-5 items-center justify-between gap-2">
                  <Skeleton className={cn('h-3', i % 2 ? 'w-24' : 'w-16')} />
                  <Skeleton className="h-2 w-20 shrink-0" />
                </div>
                <Line size="xs" width={i % 3 === 0 ? 'w-11/12' : 'w-3/4'} />
                {i % 3 === 1 && <StageChipRowSkeleton />}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </SkeletonRegion>
  )
}

/** Mirrors a Tickets row (69.5px): title + time, then stage chip + reference. */
export function WidgetTicketListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonRegion>
      <ul className="px-3 pt-1 pb-24">
        {Array.from({ length: count }, (_, i) => (
          <li
            key={i}
            className="border-b border-border/40 last:border-b-0"
            style={rowFade(i, count)}
          >
            <div className="flex w-full items-center gap-3 rounded-lg px-2 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex h-5 items-center justify-between gap-2">
                  <Skeleton className={cn('h-3', i % 2 ? 'w-3/5' : 'w-4/5')} />
                  <Skeleton className="h-2 w-20 shrink-0" />
                </div>
                <StageChipRowSkeleton />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </SkeletonRegion>
  )
}

// ── Messenger ──

/**
 * Whole-view fallback for the Messenger chunk: the thread placeholder above
 * the composer shell (same 103px `border-t p-2` well and 86px rounded box as
 * the real composer), so the composer doesn't pop in when the chunk lands.
 */
export function WidgetMessengerViewSkeleton({ isNew }: { isNew: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <ConversationThreadSkeleton variant={isNew ? 'greeting' : 'thread'} />
      </div>
      <div className="shrink-0 border-t border-border/40 p-2">
        <div className="rounded-2xl border border-border bg-background px-3 py-2.5 shadow-sm">
          <div className="flex h-6 items-center">
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex h-10 items-center justify-between pt-1">
            <div className="flex size-9 items-center justify-center">
              <Skeleton className="size-5 rounded-md" />
            </div>
            {/* The real send button, disabled: bg-primary at 40% — static. */}
            <div className="size-9 rounded-full bg-primary opacity-40" />
          </div>
        </div>
      </div>
    </div>
  )
}
