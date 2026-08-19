/**
 * Portal moderation section — the team-only affordance that surfaces posts
 * held for approval directly on the public feed, so a `post.approve` holder
 * can clear the queue without leaving the portal.
 *
 * Renders nothing for customers and non-holders: the pending-posts query is
 * gated behind `enabled` (wired to `can(PERMISSIONS.POST_APPROVE)`), so a
 * disabled viewer issues zero extra requests and sees zero extra markup.
 *
 * Reuses the existing moderation server fns verbatim — listPendingPostsFn,
 * approvePostFn, rejectPostFn — every one already gated on POST_APPROVE, so the
 * portal render gate lines up 1:1 with the server authorization.
 */
import { useRef, useState } from 'react'
import { useIntl, FormattedMessage } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ExclamationTriangleIcon,
  ArrowTopRightOnSquareIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline'
import { listPendingPostsFn, approvePostFn, rejectPostFn } from '@/lib/server/functions/moderation'
import { publicPostsKeys } from '@/lib/client/hooks/use-portal-posts-query'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TimeAgo } from '@/components/ui/time-ago'
import { contentPreview } from '@/lib/shared/utils/string'
import { cn } from '@/lib/shared/utils'

/**
 * A pending post as returned by listPendingPostsFn. Derived from the server
 * fn's own return type so the shape can never drift; `createdAt` is typed as a
 * Date by the fn even though it serialises to a string over the wire, so the
 * card normalises it with `new Date(...)` (a no-op on a real Date).
 */
type PendingPost = Awaited<ReturnType<typeof listPendingPostsFn>>['posts'][number]

// Local, portal-scoped query key. Distinct from the admin moderation queue key
// so the two surfaces cache independently (the admin queue also fetches pending
// comments, which the portal feed does not surface).
const pendingPostsKey = ['portal', 'moderation', 'pending', 'posts'] as const

interface PortalModerationSectionProps {
  /** True only for viewers holding post.approve. Gates the query and all markup. */
  enabled: boolean
}

export function PortalModerationSection({
  enabled,
}: PortalModerationSectionProps): React.ReactElement | null {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const cardsRef = useRef<HTMLDivElement>(null)
  const [rejectTarget, setRejectTarget] = useState<PendingPost | null>(null)
  const [reason, setReason] = useState('')

  const { data } = useQuery({
    queryKey: pendingPostsKey,
    queryFn: () => listPendingPostsFn(),
    enabled,
    staleTime: 30 * 1000,
  })

  const pending = data?.posts ?? []

  // Optimistically drop a decided post from the pending cache; return the prior
  // snapshot so onError can roll back if the guarded server write is rejected.
  function removeFromCache(postId: string): { posts: PendingPost[] } | undefined {
    const prev = queryClient.getQueryData<{ posts: PendingPost[] }>(pendingPostsKey)
    queryClient.setQueryData<{ posts: PendingPost[] }>(pendingPostsKey, (old) =>
      old ? { posts: old.posts.filter((p) => p.id !== postId) } : old
    )
    return prev
  }

  const approve = useMutation({
    mutationFn: (postId: string) => approvePostFn({ data: { postId } }),
    onMutate: (postId: string) => ({ prev: removeFromCache(postId) }),
    onError: (_err, _postId, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(pendingPostsKey, ctx.prev)
      toast.error(
        intl.formatMessage({
          id: 'portal.moderation.approve.error',
          defaultMessage: 'Failed to approve post',
        })
      )
    },
    onSuccess: () => {
      toast.success(
        intl.formatMessage({
          id: 'portal.moderation.approve.success',
          defaultMessage: 'Post approved',
        })
      )
      // The approved post is now published — pull it into the live feed.
      queryClient.invalidateQueries({ queryKey: publicPostsKeys.lists() })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: pendingPostsKey }),
  })

  const reject = useMutation({
    mutationFn: (vars: { postId: string; reason?: string }) =>
      rejectPostFn({ data: { postId: vars.postId, reason: vars.reason } }),
    onMutate: (vars: { postId: string; reason?: string }) => ({
      prev: removeFromCache(vars.postId),
    }),
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(pendingPostsKey, ctx.prev)
      toast.error(
        intl.formatMessage({
          id: 'portal.moderation.reject.error',
          defaultMessage: 'Failed to reject post',
        })
      )
    },
    onSuccess: () => {
      toast.success(
        intl.formatMessage({
          id: 'portal.moderation.reject.success',
          defaultMessage: 'Post rejected',
        })
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: pendingPostsKey }),
  })

  // Zero-footprint for customers, non-holders, and the empty queue: no banner,
  // no cards, nothing in the accessibility tree.
  if (!enabled || pending.length === 0) return null

  function scrollToCards(): void {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    cardsRef.current?.scrollIntoView({
      behavior: reduce ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  function confirmReject(): void {
    if (!rejectTarget) return
    reject.mutate({ postId: rejectTarget.id, reason: reason.trim() || undefined })
    setRejectTarget(null)
    setReason('')
  }

  const count = pending.length

  return (
    <section
      className="mt-5"
      aria-label={intl.formatMessage({
        id: 'portal.moderation.banner.regionLabel',
        defaultMessage: 'Posts pending approval',
      })}
    >
      {/* Banner. The count is announced politely so a screen-reader user hears
          the backlog change as posts are approved/rejected. */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm"
        aria-live="polite"
      >
        <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <span className="font-medium text-amber-800 dark:text-amber-200">
          <FormattedMessage
            id="portal.moderation.banner.count"
            defaultMessage="{count, plural, one {# post is} other {# posts are}} waiting for approval"
            values={{ count }}
          />
        </span>
        <div className="ms-auto flex items-center gap-3">
          <button
            type="button"
            onClick={scrollToCards}
            className="font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
          >
            <FormattedMessage id="portal.moderation.banner.review" defaultMessage="Review here" />
          </button>
          <Link
            to="/admin/moderation"
            className="inline-flex items-center gap-1 font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
          >
            <FormattedMessage
              id="portal.moderation.banner.openQueue"
              defaultMessage="Open queue in admin"
            />
            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Quarantined pending cards. */}
      <div ref={cardsRef} className="mt-3 space-y-3">
        {pending.map((post) => (
          <PendingPostCard
            key={post.id}
            post={post}
            busy={approve.isPending || reject.isPending}
            onApprove={() => approve.mutate(post.id)}
            onReject={() => {
              setReason('')
              setRejectTarget(post)
            }}
          />
        ))}
      </div>

      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTarget(null)
            setReason('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              <FormattedMessage
                id="portal.moderation.reject.dialogTitle"
                defaultMessage="Reject this post?"
              />
            </DialogTitle>
            <DialogDescription>
              <FormattedMessage
                id="portal.moderation.reject.dialogDescription"
                defaultMessage="Optionally record why. The reason is kept in the audit log and is not shown to the author."
              />
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="portal-moderation-reject-reason">
              <FormattedMessage
                id="portal.moderation.reject.reasonLabel"
                defaultMessage="Reason (optional)"
              />
            </Label>
            <Textarea
              id="portal-moderation-reject-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder={intl.formatMessage({
                id: 'portal.moderation.reject.reasonPlaceholder',
                defaultMessage: 'Why is this being rejected?',
              })}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null)
                setReason('')
              }}
            >
              <FormattedMessage id="portal.moderation.reject.cancel" defaultMessage="Cancel" />
            </Button>
            <Button variant="destructive" onClick={confirmReject}>
              <FormattedMessage
                id="portal.moderation.reject.confirm"
                defaultMessage="Reject post"
              />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

interface PendingPostCardProps {
  post: PendingPost
  busy: boolean
  onApprove: () => void
  onReject: () => void
}

/**
 * Lightweight quarantined card. Mirrors PostCard's anatomy (title, excerpt,
 * author, time) but drops votes/status (a pending post has neither yet) and
 * wears an amber tint. The pending state is carried in TEXT ("Pending
 * approval" + the hidden-from-customers note), never by colour alone.
 */
function PendingPostCard({
  post,
  busy,
  onApprove,
  onReject,
}: PendingPostCardProps): React.ReactElement {
  const intl = useIntl()
  const authorFallback = intl.formatMessage({
    id: 'portal.moderation.card.authorFallback',
    defaultMessage: 'Anonymous',
  })

  return (
    <div
      className={cn(
        'rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-4 dark:bg-amber-950/20',
        'animate-in fade-in duration-200 fill-mode-backwards'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            <EyeSlashIcon className="h-3.5 w-3.5" />
            <FormattedMessage
              id="portal.moderation.card.pendingLabel"
              defaultMessage="Pending approval"
            />
          </span>
          <h3 className="mt-1 line-clamp-1 text-base font-semibold text-foreground">
            {post.title}
          </h3>
          {post.content && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {contentPreview(post.content)}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="text-foreground/80">{post.authorName || authorFallback}</span>
            {post.boardName && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span>{post.boardName}</span>
              </>
            )}
            <span className="text-muted-foreground/40">·</span>
            <TimeAgo date={new Date(post.createdAt)} className="text-muted-foreground/70" />
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={onApprove} disabled={busy}>
            <FormattedMessage id="portal.moderation.card.approve" defaultMessage="Approve" />
          </Button>
          <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
            <FormattedMessage id="portal.moderation.card.reject" defaultMessage="Reject" />
          </Button>
        </div>
      </div>
      <p className="mt-2.5 text-xs text-amber-700/80 dark:text-amber-500/70">
        <FormattedMessage
          id="portal.moderation.card.hiddenNote"
          defaultMessage="Customers cannot see this post yet."
        />
      </p>
    </div>
  )
}
