'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { commentSchema, type CommentInput } from '@/lib/schemas/comments'
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
import { signOut } from '@/lib/auth/client'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { useAuthBroadcast } from '@/lib/hooks/use-auth-broadcast'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { createCommentAction } from '@/lib/actions/comments'
import type { PostId, CommentId } from '@quackback/ids'

interface SubmitCommentParams {
  postId: PostId
  content: string
  parentId?: CommentId | null
  authorName?: string | null
  authorEmail?: string | null
  memberId?: string | null
}

interface CommentFormProps {
  postId: PostId
  parentId?: CommentId
  onSuccess?: () => void
  onCancel?: () => void
  user?: { name: string | null; email: string; memberId?: string }
  /** Optional custom submit handler (e.g., TanStack Query mutation) */
  submitComment?: (params: SubmitCommentParams) => Promise<unknown>
  /** External pending state (from mutation) */
  isSubmitting?: boolean
}

export function CommentForm({
  postId,
  parentId,
  onSuccess,
  onCancel,
  user,
  submitComment,
  isSubmitting: externalIsSubmitting,
}: CommentFormProps) {
  const router = useRouter()
  const { session } = useRouteContext({ from: '__root__' })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Use external pending state if provided, otherwise use local
  const isSubmitting = externalIsSubmitting ?? isPending

  const authPopover = useAuthPopoverSafe()

  // Get user from session
  // Note: memberId is only available from the server-provided `user` prop, not from client session
  const effectiveUser = session?.user
    ? { name: session.user.name, email: session.user.email, memberId: user?.memberId }
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
      parentId: parentId || null,
    },
  })

  function onSubmit(data: CommentInput) {
    setError(null)

    const submitParams: SubmitCommentParams = {
      postId,
      content: data.content.trim(),
      parentId: parentId || null,
      authorName: effectiveUser?.name || null,
      authorEmail: effectiveUser?.email || null,
      memberId: effectiveUser?.memberId || null,
    }

    // If custom submit handler provided, use it
    if (submitComment) {
      submitComment(submitParams)
        .then(() => {
          form.reset()
          onSuccess?.()
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to post comment')
        })
      return
    }

    // Otherwise, use default server action behavior
    startTransition(async () => {
      try {
        const result = await createCommentAction({
          data: {
            postId,
            content: submitParams.content,
            parentId: submitParams.parentId,
          },
        })

        if (!result.success) {
          throw new Error(result.error.message || 'Failed to post comment')
        }

        form.reset()
        onSuccess?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to post comment')
      }
    })
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
                      refetchSession()
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
