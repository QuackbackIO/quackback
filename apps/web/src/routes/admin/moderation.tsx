import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ShieldCheckIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import {
  listPendingPostsFn,
  listPendingCommentsFn,
  approvePostFn,
  rejectPostFn,
  approveCommentFn,
  rejectCommentFn,
} from '@/lib/server/functions/moderation'
import { adminQueries } from '@/lib/client/queries/admin'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'

export const Route = createFileRoute('/admin/moderation')({
  // Auth is enforced by the parent `/admin` guard (admin/member wall) plus each
  // moderation server function's own authz — no per-route RPC guard needed.
  component: ModerationPage,
})

function ModerationPage() {
  const queryClient = useQueryClient()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const postsQuery = useQuery({
    queryKey: ['admin', 'moderation', 'pending', 'posts'],
    queryFn: () => listPendingPostsFn(),
  })
  const commentsQuery = useQuery({
    queryKey: ['admin', 'moderation', 'pending', 'comments'],
    queryFn: () => listPendingCommentsFn(),
  })

  const invalidateAfterDecision = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'moderation'] })
    queryClient.invalidateQueries({ queryKey: adminQueries.moderationStatus().queryKey })
  }

  const onError = () => {
    toast.error('This item was already handled -- refreshing the queue.')
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

  if (postsQuery.isLoading || commentsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const posts = postsQuery.data?.posts ?? []
  const comments = commentsQuery.data?.comments ?? []
  const total = posts.length + comments.length

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-border/50">
        <PageHeader
          icon={ShieldCheckIcon}
          title="Moderation Queue"
          description={
            total === 0
              ? 'Nothing pending'
              : `${total} item${total === 1 ? '' : 's'} awaiting review`
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {total === 0 ? (
          <EmptyState
            icon={ShieldCheckIcon}
            title="All caught up"
            description="No submissions are awaiting review."
          />
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
                        <p className="font-medium truncate">{post.title}</p>
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
                          <span className="font-medium text-foreground">{comment.postTitle}</span>{' '}
                          in {comment.boardName}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          by {comment.authorName ?? 'Anonymous'}
                        </p>
                        <p className="mt-1 text-sm text-foreground line-clamp-3">
                          {comment.content}
                        </p>
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
    </div>
  )
}
