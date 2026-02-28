import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { UseMutationResult } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { commentSchema, type CommentInput } from '@/lib/shared/schemas/comments'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StatusBadge } from '@/components/ui/status-badge'
import { CheckIcon } from '@heroicons/react/24/solid'
import { signOut } from '@/lib/server/auth/client'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { cn } from '@/lib/shared/utils'
import type { PostId, CommentId } from '@quackback/ids'

export type CreateCommentMutation = UseMutationResult<
  unknown,
  Error,
  {
    content: string
    parentId?: string | null
    postId: string
    authorName?: string | null
    authorEmail?: string | null
    principalId?: string | null
    statusId?: string | null
  }
>

interface CommentFormProps {
  postId: PostId
  parentId?: CommentId
  onSuccess?: () => void
  onCancel?: () => void
  user?: { name: string | null; email: string; principalId?: string }
  /** React Query mutation for creating comments with optimistic updates */
  createComment?: CreateCommentMutation
  /** Available statuses for status change selector (admin only) */
  statuses?: Array<{ id: string; name: string; color: string }>
  /** Current post status ID */
  currentStatusId?: string | null
  /** Whether the current user is a team member (enables status selector) */
  isTeamMember?: boolean
}

export function CommentForm({
  postId,
  parentId,
  onSuccess,
  onCancel,
  user,
  createComment,
  statuses,
  currentStatusId,
  isTeamMember,
}: CommentFormProps) {
  const router = useRouter()
  const { session } = useRouteContext({ from: '__root__' })
  const [error, setError] = useState<string | null>(null)
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null)
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false)

  const authPopover = useAuthPopoverSafe()

  // Get user from session
  // Note: principalId is only available from the server-provided `user` prop, not from client session
  const effectiveUser = session?.user
    ? { name: session.user.name, email: session.user.email, principalId: user?.principalId }
    : user

  // Listen for auth success to refetch session (no page reload)
  useAuthBroadcast({
    onSuccess: () => {
      router.invalidate()
    },
  })

  const form = useForm<CommentInput>({
    resolver: standardSchemaResolver(commentSchema),
    defaultValues: {
      content: '',
      parentId: parentId || undefined,
    },
  })

  const isSubmitting = createComment?.isPending ?? false
  const selectedStatus = statuses?.find((s) => s.id === selectedStatusId) ?? null
  const currentStatus = statuses?.find((s) => s.id === currentStatusId) ?? null
  const showStatusSelector = isTeamMember && !parentId && statuses && statuses.length > 0

  function onSubmit(data: CommentInput) {
    setError(null)

    if (!createComment) {
      setError('Comment functionality not available')
      return
    }

    createComment.mutate(
      {
        content: data.content.trim(),
        parentId: parentId || null,
        postId,
        authorName: effectiveUser?.name || null,
        authorEmail: effectiveUser?.email || null,
        principalId: effectiveUser?.principalId || null,
        statusId: selectedStatusId,
      },
      {
        onSuccess: () => {
          form.reset()
          setSelectedStatusId(null)
          onSuccess?.()
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Failed to post comment')
        },
      }
    )
  }

  // If not authenticated, show sign-in prompt
  if (!effectiveUser) {
    return (
      <div className="flex items-center justify-center py-4 px-4 bg-muted/30 [border-radius:var(--radius)] border border-border/30">
        <p className="text-sm text-muted-foreground mr-3">Sign in to comment</p>
        {authPopover && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => authPopover.openAuthPopover({ mode: 'login' })}
          >
            Sign in
          </Button>
        )}
      </div>
    )
  }

  // Team member composer: unified card with toolbar
  if (showStatusSelector) {
    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="rounded-lg border border-border/50 bg-background overflow-hidden focus-within:border-border focus-within:ring-1 focus-within:ring-ring/20 transition-colors">
            {/* Textarea area */}
            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">Your comment</FormLabel>
                  <FormControl>
                    <textarea
                      placeholder="Write a comment..."
                      rows={3}
                      disabled={isSubmitting}
                      className="w-full resize-none border-0 bg-transparent px-3 pt-3 pb-2 text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="px-3" />
                </FormItem>
              )}
            />

            {error && <p className="text-sm text-destructive px-3 pb-1">{error}</p>}

            {/* Toolbar footer */}
            <div className="flex items-center gap-2 border-t border-border/30 bg-muted/20 px-3 py-2">
              {/* Left: Identity */}
              <p className="text-xs text-muted-foreground mr-auto truncate">
                <span className="font-medium text-foreground">
                  {effectiveUser.name || effectiveUser.email}
                </span>
              </p>

              {/* Status selector */}
              <Popover open={statusPopoverOpen} onOpenChange={setStatusPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                      'hover:bg-muted/80',
                      selectedStatus
                        ? 'bg-muted/60 border border-border/50'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {selectedStatus ? (
                      <>
                        <StatusBadge name={selectedStatus.name} color={selectedStatus.color} />
                        <button
                          type="button"
                          className="ml-0.5 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedStatusId(null)
                          }}
                        >
                          &times;
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          className="size-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: currentStatus?.color ?? '#94a3b8' }}
                        />
                        <span>{currentStatus?.name ?? 'No status'}</span>
                      </>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-1" align="end">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Update status
                  </div>
                  {statuses.map((status) => {
                    const isCurrent = status.id === currentStatusId
                    const isSelected = status.id === selectedStatusId
                    return (
                      <button
                        key={status.id}
                        type="button"
                        onClick={() => {
                          setSelectedStatusId(isCurrent ? null : status.id)
                          setStatusPopoverOpen(false)
                        }}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs transition-colors',
                          'hover:bg-muted/50',
                          isSelected && 'bg-muted/40'
                        )}
                      >
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: status.color }}
                        />
                        <span className="flex-1 text-left">{status.name}</span>
                        {isCurrent && !isSelected && (
                          <span className="text-muted-foreground text-[10px]">current</span>
                        )}
                        {isSelected && <CheckIcon className="size-3.5 text-primary shrink-0" />}
                      </button>
                    )
                  })}
                  {selectedStatusId && (
                    <>
                      <div className="my-1 border-t border-border/30" />
                      <button
                        type="button"
                        className="w-full text-left px-2 py-1.5 text-xs rounded-sm hover:bg-muted/50 transition-colors text-muted-foreground"
                        onClick={() => {
                          setSelectedStatusId(null)
                          setStatusPopoverOpen(false)
                        }}
                      >
                        Clear status change
                      </button>
                    </>
                  )}
                </PopoverContent>
              </Popover>

              {/* Submit */}
              {onCancel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  disabled={isSubmitting}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" size="sm" disabled={isSubmitting} className="h-7 text-xs">
                {isSubmitting
                  ? 'Posting...'
                  : selectedStatus
                    ? `Comment & mark ${selectedStatus.name}`
                    : 'Comment'}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    )
  }

  // Default composer for non-team-members / replies
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">Your comment</FormLabel>
              <FormControl>
                <textarea
                  placeholder="Write a comment..."
                  rows={3}
                  disabled={isSubmitting}
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <p className="text-xs text-muted-foreground mr-auto">
            Posting as{' '}
            <span className="font-medium text-foreground">
              {effectiveUser.name || effectiveUser.email}
            </span>
            {' ('}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => {
                signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      router.invalidate()
                    },
                  },
                })
              }}
            >
              sign out
            </button>
            {')'}
          </p>
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? 'Posting...' : parentId ? 'Reply' : 'Comment'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
