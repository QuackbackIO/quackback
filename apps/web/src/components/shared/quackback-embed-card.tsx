import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import type { PostId } from '@quackback/ids'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { StatusBadge } from '@/components/ui/status-badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { getEmbedPreviewFn } from '@/lib/server/functions/embeds'
import { usePostVote } from '@/lib/client/hooks/use-post-vote'
import { cn, getInitials } from '@/lib/shared/utils'

const voteBoxCls =
  'flex w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border py-1.5'

/** Display-only vote tally — used in the editor preview (no voting). */
function StaticVoteBox({ voteCount }: { voteCount: number }) {
  return (
    <div className={cn(voteBoxCls, 'border-border/50 bg-muted/40 text-muted-foreground')}>
      <ChevronUpIcon className="h-3.5 w-3.5" />
      <span className="text-sm font-semibold tabular-nums text-foreground">{voteCount}</span>
    </div>
  )
}

/**
 * Live vote button — same behavior as the portal PostCard: optimistic toggle,
 * and `handleVote` stops propagation so the click never triggers the card's
 * link navigation. Mounted only on live display surfaces (never in the editor).
 */
function InteractiveVoteBox({
  postId,
  voteCount,
  getAuthHeaders,
}: {
  postId: string
  voteCount: number
  getAuthHeaders?: () => Record<string, string>
}) {
  const {
    voteCount: vc,
    hasVoted,
    isPending,
    handleVote,
  } = usePostVote({
    postId: postId as PostId,
    voteCount,
    getAuthHeaders,
  })
  return (
    <button
      type="button"
      onClick={(e) => handleVote(e)}
      disabled={isPending}
      aria-pressed={hasVoted}
      className={cn(
        voteBoxCls,
        'transition-colors',
        hasVoted
          ? 'border-post-card-voted/60 bg-post-card-voted/15 text-post-card-voted'
          : 'border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground/80',
        isPending && 'cursor-wait opacity-70'
      )}
    >
      <ChevronUpIcon className={cn('h-3.5 w-3.5', hasVoted && 'fill-post-card-voted')} />
      <span className="text-sm font-semibold tabular-nums text-foreground">{vc}</span>
    </button>
  )
}

// Bounded so an embed never stretches to the full content width — a contained
// card that reads as a miniature of the portal PostCard.
const shellCls =
  'quackback-embed not-prose my-2 block w-full max-w-md overflow-hidden rounded-lg border border-border bg-card no-underline'

/**
 * How clicking a live embed card opens its target — chosen per mounting surface:
 * - `navigate` (default): same-tab `<a href>` to the relative portal path. Used
 *   by post bodies / changelog / comments display.
 * - `newTab`: `<a target="_blank">` to the absolute portal URL. Used by the
 *   widget messenger, whose iframe origin may differ from the portal's.
 * - `modal`: a clickable region that calls `onOpenInModal(postId)` instead of
 *   navigating. Used by the admin conversation view so a shared post opens in place (like
 *   clicking a roadmap item) rather than leaving the inbox.
 */
export type EmbedOpenMode = 'navigate' | 'newTab' | 'modal'

/**
 * Picks the card's outer element for the active {@link EmbedOpenMode}. A nested
 * vote button stops propagation, so it never triggers the wrapper's click.
 */
function EmbedShell({
  href,
  openMode,
  modalTarget,
  onOpenInModal,
  children,
}: {
  /** Relative path (navigate) or absolute URL (newTab). Ignored in modal mode. */
  href: string
  openMode: EmbedOpenMode
  /** The post id to open in modal mode; absent for changelog (falls back). */
  modalTarget?: string
  onOpenInModal?: (postId: string) => void
  children: ReactNode
}) {
  if (openMode === 'modal' && onOpenInModal && modalTarget) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={cn(shellCls, 'cursor-pointer text-left')}
        onClick={() => onOpenInModal(modalTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenInModal(modalTarget)
          }
        }}
      >
        {children}
      </div>
    )
  }
  if (openMode === 'newTab') {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={shellCls}>
        {children}
      </a>
    )
  }
  return (
    <a href={href} className={shellCls}>
      {children}
    </a>
  )
}

/**
 * A live Quackback link embed. Given a parsed `{ kind, id }`, it resolves the
 * referenced post/changelog *fresh* (votes, status, title, tags all current) and
 * renders a compact card — a miniature of the portal post card. Anything the
 * viewer can't see degrades to a muted "unavailable" placeholder. Presentational
 * + self-contained: it uses a plain `<a href>` (not the router `Link`) so it
 * works on static display HTML where the router context may be absent.
 */
export function QuackbackEmbedCard({
  kind,
  id,
  interactive = true,
  openMode = 'navigate',
  onOpenInModal,
  getAuthHeaders,
}: {
  kind: 'post' | 'changelog' | 'article'
  id: string
  /** Live surfaces (default) get a working vote button + a clickable card; the
   *  in-editor preview passes `false` for an inert, non-navigating card. */
  interactive?: boolean
  /** How a click opens the target — see {@link EmbedOpenMode}. Defaults to
   *  same-tab navigation; conversation surfaces override (widget → newTab, admin →
   *  modal). Ignored when `interactive` is false. */
  openMode?: EmbedOpenMode
  /** Required for `modal` mode: opens the referenced post in place. */
  onOpenInModal?: (postId: string) => void
  /**
   * Called at request time to supply auth headers. Surfaces where cookie-based
   * session is unavailable (e.g. the widget iframe) pass this so the preview
   * fetch and the vote mutation both carry the correct credentials. Portal and
   * admin callers omit it; cookie auth continues to work unchanged.
   */
  getAuthHeaders?: () => Record<string, string>
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['embed', kind, id],
    queryFn: () =>
      getEmbedPreviewFn({
        data: { kind, id },
        ...(getAuthHeaders ? { headers: getAuthHeaders() } : {}),
      }),
    staleTime: 60_000,
  })

  if (isLoading || !data) {
    return (
      <div className={`${shellCls} p-3`}>
        <div className="flex items-start gap-3">
          <div className="size-9 shrink-0 animate-pulse rounded-md bg-muted" />
          <div className="flex-1 space-y-2 py-0.5">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
    )
  }

  if ('unavailable' in data) {
    const label = kind === 'post' ? 'post' : kind === 'article' ? 'article' : 'update'
    return (
      <div className={`${shellCls} px-3 py-2.5 text-xs text-muted-foreground`}>
        This {label} is unavailable
      </div>
    )
  }

  if (data.kind === 'post') {
    const inner = (
      <div className="flex items-start gap-3 p-3">
        {interactive ? (
          <InteractiveVoteBox
            postId={data.postId}
            voteCount={data.voteCount}
            getAuthHeaders={getAuthHeaders}
          />
        ) : (
          <StaticVoteBox voteCount={data.voteCount} />
        )}

        <div className="min-w-0 flex-1">
          {data.statusName && (
            <StatusBadge name={data.statusName} color={data.statusColor} className="mb-1" />
          )}
          <h3 className="line-clamp-1 text-sm font-semibold text-foreground">{data.title}</h3>
          {data.excerpt && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/70">{data.excerpt}</p>
          )}

          {data.tags.length > 0 && (
            <div className="mt-1.5 flex items-center gap-1">
              {data.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center rounded px-1.5 py-0 text-[11px] font-medium"
                  style={
                    tag.color ? { backgroundColor: `${tag.color}20`, color: tag.color } : undefined
                  }
                >
                  {tag.name}
                </span>
              ))}
              {data.tags.length > 3 && (
                <span className="text-[10px] text-muted-foreground/60">
                  +{data.tags.length - 3}
                </span>
              )}
            </div>
          )}

          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Avatar className="size-4">
              {data.authorAvatarUrl && (
                <AvatarImage src={data.authorAvatarUrl} alt={data.authorName ?? 'Anonymous'} />
              )}
              <AvatarFallback className="bg-muted text-[8px]">
                {getInitials(data.authorName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{data.authorName ?? 'Anonymous'}</span>
            {data.createdAt && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <TimeAgo date={new Date(data.createdAt)} className="text-muted-foreground/70" />
              </>
            )}
          </div>
        </div>
      </div>
    )
    if (!interactive) return <div className={shellCls}>{inner}</div>
    const href = openMode === 'newTab' ? data.url : `/b/${data.boardSlug}/posts/${data.postId}`
    return (
      <EmbedShell
        href={href}
        openMode={openMode}
        modalTarget={data.postId}
        onOpenInModal={onOpenInModal}
      >
        {inner}
      </EmbedShell>
    )
  }

  if (data.kind === 'article') {
    const articleInner = (
      <div className="p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Help article
        </p>
        <h3 className="mt-0.5 line-clamp-1 text-sm font-semibold text-foreground">{data.title}</h3>
        {data.excerpt && (
          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{data.excerpt}</p>
        )}
      </div>
    )
    if (!interactive) return <div className={shellCls}>{articleInner}</div>
    // Help-center articles have no "open in modal" concept — modal surfaces
    // open them in a new tab rather than navigating away from the inbox.
    const arOpenMode = openMode === 'modal' ? 'newTab' : openMode
    const arHref =
      arOpenMode === 'newTab' ? data.url : `/hc/articles/${data.categorySlug}/${data.articleId}`
    return (
      <EmbedShell href={arHref} openMode={arOpenMode}>
        {articleInner}
      </EmbedShell>
    )
  }

  // Changelog: a compact card (no vote tally — changelog entries aren't voted on).
  const changelogInner = (
    <div className="p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        Changelog
      </p>
      <h3 className="mt-0.5 line-clamp-1 text-sm font-semibold text-foreground">{data.title}</h3>
      {data.publishedAt && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {format(new Date(data.publishedAt), 'MMM d, yyyy')}
        </p>
      )}
    </div>
  )
  if (!interactive) return <div className={shellCls}>{changelogInner}</div>
  // A changelog entry has no post to open in place, so modal surfaces (admin
  // conversation view) open it in a new tab rather than navigating away from the inbox.
  const clOpenMode = openMode === 'modal' ? 'newTab' : openMode
  const clHref = clOpenMode === 'newTab' ? data.url : `/changelog/${data.entryId}`
  return (
    <EmbedShell href={clHref} openMode={clOpenMode}>
      {changelogInner}
    </EmbedShell>
  )
}
