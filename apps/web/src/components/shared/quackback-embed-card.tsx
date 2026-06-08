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
function InteractiveVoteBox({ postId, voteCount }: { postId: string; voteCount: number }) {
  const {
    voteCount: vc,
    hasVoted,
    isPending,
    handleVote,
  } = usePostVote({
    postId: postId as PostId,
    voteCount,
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
}: {
  kind: 'post' | 'changelog'
  id: string
  /** Live surfaces (default) get a working vote button + a clickable card; the
   *  in-editor preview passes `false` for an inert, non-navigating card. */
  interactive?: boolean
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['embed', kind, id],
    queryFn: () => getEmbedPreviewFn({ data: { kind, id } }),
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
    return (
      <div className={`${shellCls} px-3 py-2.5 text-xs text-muted-foreground`}>
        This {kind === 'post' ? 'post' : 'update'} is unavailable
      </div>
    )
  }

  if (data.kind === 'post') {
    const inner = (
      <div className="flex items-start gap-3 p-3">
        {interactive ? (
          <InteractiveVoteBox postId={data.postId} voteCount={data.voteCount} />
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
                  className="inline-flex items-center rounded px-1.5 py-0 text-[10px] font-medium"
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
    return interactive ? (
      <a href={`/b/${data.boardSlug}/posts/${data.postId}`} className={shellCls}>
        {inner}
      </a>
    ) : (
      <div className={shellCls}>{inner}</div>
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
  return interactive ? (
    <a href={`/changelog/${data.entryId}`} className={shellCls}>
      {changelogInner}
    </a>
  ) : (
    <div className={shellCls}>{changelogInner}</div>
  )
}
