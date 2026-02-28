import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { UseMutationResult } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { commentSchema, type CommentInput } from '@/lib/shared/schemas/comments'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/ui/status-badge'
import { LockClosedIcon, LockOpenIcon } from '@heroicons/react/24/solid'
import { signOut } from '@/lib/server/auth/client'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
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
    isPrivate?: boolean
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
  /** Whether the current user is a team member (enables status selector and private toggle) */
  isTeamMember?: boolean
  /** Force comment to be private (for replies to private comments) */
  forcePrivate?: boolean
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
  forcePrivate,
}: CommentFormProps) {
  const router = useRouter()
  const { session } = useRouteContext({ from: '__root__' })
  const [error, setError] = useState<string | null>(null)
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null)
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false)
  const [isPrivate, setIsPrivate] = useState(false)
  const effectiveIsPrivate = forcePrivate || isPrivate

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

  function privateTooltipText(): string {
    if (forcePrivate) return 'Replies to private comments are always private'
    if (effectiveIsPrivate) return 'Only visible to team members'
    return 'Make this comment private (team-only)'
  }

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
        isPrivate: effectiveIsPrivate,
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
                <Textarea
                  placeholder="Write a comment..."
                  rows={3}
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Status selector for team members on root comments */}
        {isTeamMember && !parentId && statuses && statuses.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Status:</span>
            <Popover open={statusPopoverOpen} onOpenChange={setStatusPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/50 hover:bg-muted/50 transition-colors text-xs"
                >
                  {selectedStatus ? (
                    <StatusBadge name={selectedStatus.name} color={selectedStatus.color} />
                  ) : (
                    <span className="text-muted-foreground">No change</span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" align="start">
                <button
                  type="button"
                  className="w-full text-left px-2 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-muted-foreground"
                  onClick={() => {
                    setSelectedStatusId(null)
                    setStatusPopoverOpen(false)
                  }}
                >
                  No change
                </button>
                {statuses.map((status) => (
                  <button
                    key={status.id}
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors"
                    onClick={() => {
                      setSelectedStatusId(status.id === currentStatusId ? null : status.id)
                      setStatusPopoverOpen(false)
                    }}
                  >
                    <StatusBadge name={status.name} color={status.color} />
                    {status.id === currentStatusId && (
                      <span className="text-muted-foreground ml-1">(current)</span>
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        )}

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
          {/* Private toggle for team members */}
          {isTeamMember && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={effectiveIsPrivate ? 'default' : 'ghost'}
                    size="sm"
                    disabled={forcePrivate}
                    onClick={() => setIsPrivate(!isPrivate)}
                    className={
                      effectiveIsPrivate
                        ? 'bg-amber-500 hover:bg-amber-600 text-white border-0 gap-1.5'
                        : 'text-muted-foreground gap-1.5'
                    }
                  >
                    {effectiveIsPrivate ? (
                      <LockClosedIcon className="h-3.5 w-3.5" />
                    ) : (
                      <LockOpenIcon className="h-3.5 w-3.5" />
                    )}
                    Private
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{privateTooltipText()}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? 'Posting...' : parentId ? 'Reply' : 'Comment'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
