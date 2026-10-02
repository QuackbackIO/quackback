import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ShieldCheckIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import {
  approvePostFn,
  rejectPostFn,
  approveCommentFn,
  rejectCommentFn,
} from '@/lib/server/functions/moderation'
import { adminQueries } from '@/lib/client/queries/admin'
import { moderationQueueQueries } from '@/lib/client/queries/moderation'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { InboxLayout } from '@/components/admin/feedback/inbox-layout'
import { InboxFiltersPanel } from '@/components/admin/feedback/inbox-filters'
import { useInboxFilters } from '@/components/admin/feedback/use-inbox-filters'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { CommentContent } from '@/components/public/comment-content'
import type { TiptapContent } from '@/lib/shared/db-types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { warmQuery } from '@/lib/client/queries/warm-query'

export const Route = createFileRoute('/admin/feedback/moderation')({
  // The parent `/admin` guard admits team members; the queue needs the
  // permission its server functions check, so a teammate without it is turned
  // away instead of seeing an empty queue.
  beforeLoad: ({ context }) => assertRoutePermission(context.permissions, PERMISSIONS.POST_APPROVE),
  // The queue arrives with the page; a failed read is left to the page's own
  // query.
  loader: async ({ context }) => {
    const { queryClient, permissions } = context
    // Imported here rather than at the top: route loaders ship in the entry
    // chunk every page loads.
    const [{ moderationQueueQueries }, { defaultInboxFilters, inboxFacetCountsOptions }] =
      await Promise.all([
        import('@/lib/client/queries/moderation'),
        import('@/lib/client/hooks/use-inbox-query'),
      ])
    await Promise.all([
      warmQuery(queryClient, moderationQueueQueries.posts()),
      warmQuery(queryClient, moderationQueueQueries.comments()),
      // The Feedback pane beside the queue.
      warmQuery(queryClient, adminQueries.boards()),
      warmQuery(queryClient, adminQueries.tags()),
      warmQuery(queryClient, adminQueries.statuses()),
      warmQuery(queryClient, inboxFacetCountsOptions(defaultInboxFilters)),
      // The segment filter, which listSegmentsFn serves only with segment.view.
      permissions?.includes(PERMISSIONS.SEGMENT_VIEW)
        ? warmQuery(queryClient, adminQueries.segments())
        : undefined,
    ])
  },
  component: ModerationPage,
})

function ModerationPage() {
  const queryClient = useQueryClient()
  const [pendingId, setPendingId] = useState<string | null>(null)

  // The Feedback pane beside the queue; its filters open the post list.
  const { filters, setFilters } = useInboxFilters()
  const { data: segments } = useSegments()
  const boardsQuery = useQuery(adminQueries.boards())
  const tagsQuery = useQuery(adminQueries.tags())
  const statusesQuery = useQuery(adminQueries.statuses())

  const postsQuery = useQuery(moderationQueueQueries.posts())
  const commentsQuery = useQuery(moderationQueueQueries.comments())

  const invalidateAfterDecision = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'moderation'] })
    queryClient.invalidateQueries({ queryKey: adminQueries.moderationStatus().queryKey })
    // Reject soft-deletes the post, so the settings list count must refresh.
    queryClient.invalidateQueries({ queryKey: adminQueries.boardsWithCounts().queryKey })
  }

  const onError = () => {
    toast.error('This item was already handled. Refreshing the queue.')
    invalidateAfterDecision()
  }

  // Every approve/reject mutation shares the same cache invalidation, the
  // "already handled" toast, and the pending-row reset.
  const decisionOptions = {
    onSuccess: invalidateAfterDecision,
    onError,
    onSettled: () => setPendingId(null),
  }
  const approvePost = useMutation({
    mutationFn: (postId: string) => approvePostFn({ data: { postId } }),
    ...decisionOptions,
  })
  const rejectPost = useMutation({
    mutationFn: (postId: string) => rejectPostFn({ data: { postId } }),
    ...decisionOptions,
  })
  const approveComment = useMutation({
    mutationFn: (commentId: string) => approveCommentFn({ data: { commentId } }),
    ...decisionOptions,
  })
  const rejectComment = useMutation({
    mutationFn: (commentId: string) => rejectCommentFn({ data: { commentId } }),
    ...decisionOptions,
  })

  const posts = postsQuery.data?.posts ?? []
  const comments = commentsQuery.data?.comments ?? []
  const total = posts.length + comments.length
  const loading = postsQuery.isLoading || commentsQuery.isLoading

  return (
    <InboxLayout
      headerTitle="Feedback"
      filters={
        <InboxFiltersPanel
          filters={filters}
          onFiltersChange={setFilters}
          boards={boardsQuery.data ?? []}
          tags={tagsQuery.data ?? []}
          statuses={statusesQuery.data ?? []}
          segments={segments}
          moderationActive
        />
      }
    >
      <div className="max-w-5xl w-full px-3 pt-3.5 pb-6 space-y-6">
        <PageHeader title="Moderation" />

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : total === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card">
            <EmptyState
              icon={ShieldCheckIcon}
              title="Nothing to review"
              description="Posts and comments held for approval appear here."
              size="compact"
            />
          </div>
        ) : (
          <>
            {posts.length > 0 && (
              <section>
                <h2 className="text-sm font-medium text-muted-foreground mb-3">
                  Pending posts ({posts.length})
                </h2>
                <ul className="space-y-3">
                  {posts.map((post) => (
                    <li
                      key={post.id}
                      className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          <Link
                            to="/admin/feedback"
                            search={{ post: post.id as string }}
                            className="hover:underline"
                          >
                            {post.title}
                          </Link>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          by {post.authorName ?? 'Anonymous'} in {post.boardName}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                          {post.content}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setPendingId(post.id as string)
                            approvePost.mutate(post.id as string)
                          }}
                          disabled={pendingId === post.id}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setPendingId(post.id as string)
                            rejectPost.mutate(post.id as string)
                          }}
                          disabled={pendingId === post.id}
                        >
                          Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {comments.length > 0 && (
              <section>
                <h2 className="text-sm font-medium text-muted-foreground mb-3">
                  Pending comments ({comments.length})
                </h2>
                <ul className="space-y-3">
                  {comments.map((comment) => (
                    <li
                      key={comment.id}
                      className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-muted-foreground">
                          on{' '}
                          <Link
                            to="/admin/feedback"
                            search={{ post: comment.postId as string }}
                            hash={`comment-${comment.id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {comment.postTitle}
                          </Link>{' '}
                          in {comment.boardName}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          by {comment.authorName ?? 'Anonymous'}
                        </p>
                        <div className="mt-1 text-sm text-foreground line-clamp-3">
                          <CommentContent
                            content={comment.content}
                            contentJson={comment.contentJson as TiptapContent | null}
                          />
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setPendingId(comment.id as string)
                            approveComment.mutate(comment.id as string)
                          }}
                          disabled={pendingId === comment.id}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setPendingId(comment.id as string)
                            rejectComment.mutate(comment.id as string)
                          }}
                          disabled={pendingId === comment.id}
                        >
                          Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </InboxLayout>
  )
}
