import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheckIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { listPendingPostsFn, approvePostFn, rejectPostFn } from '@/lib/server/functions/moderation'
import { adminQueries } from '@/lib/client/queries/admin'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'

export const Route = createFileRoute('/admin/moderation')({
  loader: async () => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
    return {}
  },
  component: ModerationPage,
})

function ModerationPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'moderation', 'pending'],
    queryFn: () => listPendingPostsFn(),
  })

  const invalidateAfterDecision = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'moderation'] })
    queryClient.invalidateQueries({ queryKey: adminQueries.moderationStatus().queryKey })
  }

  const onError = () => {
    toast.error('This post was already handled -- refreshing the queue.')
    invalidateAfterDecision()
  }

  const approve = useMutation({
    mutationFn: (postId: string) => approvePostFn({ data: { postId } }),
    onSuccess: invalidateAfterDecision,
    onError,
  })
  const reject = useMutation({
    mutationFn: (postId: string) => rejectPostFn({ data: { postId } }),
    onSuccess: invalidateAfterDecision,
    onError,
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const posts = data?.posts ?? []

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <ShieldCheckIcon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Moderation Queue</h1>
            <p className="text-xs text-muted-foreground">
              {posts.length === 0
                ? 'Nothing pending'
                : `${posts.length} post${posts.length === 1 ? '' : 's'} awaiting review`}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {posts.length === 0 ? (
          <EmptyState
            icon={ShieldCheckIcon}
            title="All caught up"
            description="No submissions are awaiting review."
          />
        ) : (
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
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{post.content}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    onClick={() => approve.mutate(post.id as string)}
                    disabled={approve.isPending}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => reject.mutate(post.id as string)}
                    disabled={reject.isPending}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
