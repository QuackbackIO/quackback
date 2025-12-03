'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, Controller } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createPostSchema, type CreatePostInput, type PostStatus } from '@/lib/schemas/posts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { PenSquare } from 'lucide-react'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import type { Board, Tag, PostStatusEntity } from '@quackback/db'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

interface CreatePostDialogProps {
  organizationId: string
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  onPostCreated?: () => void
}

export function CreatePostDialog({
  organizationId,
  boards,
  tags,
  statuses,
  onPostCreated,
}: CreatePostDialogProps) {
  // Find the default status for new posts
  const defaultStatus = statuses.find((s) => s.isDefault)?.slug || statuses[0]?.slug || 'open'
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  const form = useForm<CreatePostInput>({
    resolver: standardSchemaResolver(createPostSchema),
    defaultValues: {
      title: '',
      content: '',
      boardId: boards[0]?.id || '',
      status: defaultStatus as PostStatus,
      tagIds: [] as string[],
    },
  })

  async function onSubmit(data: CreatePostInput) {
    setError('')

    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          organizationId,
        }),
      })

      if (!response.ok) {
        const responseData = await response.json()
        throw new Error(responseData.error || 'Failed to create post')
      }

      setOpen(false)
      form.reset()
      router.refresh()
      onPostCreated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create post')
    }
  }

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      form.reset()
      setError('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Create new post">
          <PenSquare className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Create new post</DialogTitle>
              <DialogDescription>
                Create a new feedback post on behalf of your team or a user.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter a descriptive title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <RichTextEditor
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Describe the feedback in detail..."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="boardId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Board</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select board" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {boards.map((board) => (
                            <SelectItem key={board.id} value={board.id}>
                              {board.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {statuses.map((status) => (
                            <SelectItem key={status.id} value={status.slug}>
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: status.color }}
                                />
                                {status.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {tags.length > 0 && (
                <Controller
                  control={form.control}
                  name="tagIds"
                  render={({ field }) => {
                    const selectedIds = field.value ?? []
                    return (
                      <FormItem>
                        <FormLabel>Tags</FormLabel>
                        <div className="flex flex-wrap gap-2">
                          {tags.map((tag) => {
                            const isSelected = selectedIds.includes(tag.id)
                            return (
                              <Badge
                                key={tag.id}
                                variant={isSelected ? 'default' : 'outline'}
                                className="cursor-pointer"
                                style={
                                  isSelected
                                    ? { backgroundColor: tag.color, borderColor: tag.color }
                                    : { borderColor: tag.color, color: tag.color }
                                }
                                onClick={() => {
                                  if (isSelected) {
                                    field.onChange(selectedIds.filter((id) => id !== tag.id))
                                  } else {
                                    field.onChange([...selectedIds, tag.id])
                                  }
                                }}
                              >
                                {tag.name}
                              </Badge>
                            )
                          })}
                        </div>
                      </FormItem>
                    )
                  }}
                />
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creating...' : 'Create post'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
