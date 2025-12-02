'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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

interface CommentFormProps {
  postId: string
  parentId?: string
  onSuccess?: () => void
  onCancel?: () => void
}

export function CommentForm({ postId, parentId, onSuccess, onCancel }: CommentFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const form = useForm<CommentInput>({
    resolver: zodResolver(commentSchema),
    defaultValues: {
      content: '',
      authorName: '',
      authorEmail: '',
      parentId: parentId || null,
    },
  })

  function onSubmit(data: CommentInput) {
    setError(null)

    startTransition(async () => {
      try {
        const response = await fetch(`/api/public/posts/${postId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: data.content.trim(),
            authorName: data.authorName?.trim() || null,
            authorEmail: data.authorEmail?.trim() || null,
            parentId: parentId || null,
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
                  disabled={isPending}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="authorName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">
                  Name (optional)
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="Your name"
                    disabled={isPending}
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
                    disabled={isPending}
                    {...field}
                    value={field.value || ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Posting...' : parentId ? 'Reply' : 'Comment'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
