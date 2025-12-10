'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { commentSchema, type CommentInput } from '@/lib/schemas/comments'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { useSession, signOut } from '@/lib/auth/client'
import { useAuthBroadcast } from '@/lib/hooks/use-auth-broadcast'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'

interface SubmitCommentParams {
  postId: string
  content: string
  parentId?: string | null
  authorName?: string | null
  authorEmail?: string | null
}

interface CommentFormProps {
  postId: string
  parentId?: string
  onSuccess?: () => void
  onCancel?: () => void
  user?: { name: string | null; email: string }
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
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Use external pending state if provided, otherwise use local
  const isSubmitting = externalIsSubmitting ?? isPending

  // Client-side session state - updates without page reload
  const { data: sessionData, refetch: refetchSession } = useSession()
  const authPopover = useAuthPopoverSafe()

  // Derive effective user: prefer fresh client session over stale server prop
  const effectiveUser =
    sessionData === undefined
      ? user
      : sessionData?.user
        ? { name: sessionData.user.name, email: sessionData.user.email }
        : null

  // Listen for auth success to refetch session (no page reload)
  useAuthBroadcast({
    onSuccess: () => {
      refetchSession()
    },
  })

  const form = useForm<CommentInput>({
    resolver: standardSchemaResolver(commentSchema),
    defaultValues: {
      content: '',
      authorName: '',
      authorEmail: '',
      parentId: parentId || null,
    },
  })

  function onSubmit(data: CommentInput) {
    setError(null)

    const submitParams: SubmitCommentParams = {
      postId,
      content: data.content.trim(),
      parentId: parentId || null,
      authorName: data.authorName?.trim() || null,
      authorEmail: data.authorEmail?.trim() || null,
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

    // Otherwise, use default fetch behavior
    startTransition(async () => {
      try {
        const response = await fetch(`/api/public/posts/${postId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: submitParams.content,
            authorName: submitParams.authorName,
            authorEmail: submitParams.authorEmail,
            parentId: submitParams.parentId,
          }),
        })

        if (!response.ok) {
          const responseData = await response.json()
          throw new Error(responseData.error || 'Failed to post comment')
        }

        form.reset()
        onSuccess?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to post comment')
      }
    })
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

        {!effectiveUser && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="authorName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-muted-foreground">Name (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Your name"
                      disabled={isSubmitting}
                      {...field}
                      value={field.value || ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="authorEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-muted-foreground">
                    Email (optional, not shown publicly)
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      disabled={isSubmitting}
                      {...field}
                      value={field.value || ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          {effectiveUser ? (
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
          ) : authPopover ? (
            <button
              type="button"
              onClick={() => authPopover.openAuthPopover({ mode: 'login' })}
              className="text-xs text-primary hover:underline font-medium mr-auto"
            >
              Sign in to comment
            </button>
          ) : null}
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
