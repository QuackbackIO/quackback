'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { boardIdSchema, statusIdSchema, tagIdsSchema } from '@quackback/ids/zod'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { RichTextEditor, richTextToPlainText } from '@/components/ui/rich-text-editor'
import { useUpdatePost, useUpdatePostTags } from '@/lib/hooks/use-inbox-queries'
import type { JSONContent } from '@tiptap/react'
import type { Board, Tag, PostStatusEntity } from '@/lib/db'
import type { BoardId, PostId, StatusId, TagId } from '@quackback/ids'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'

const editPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Description is required').max(10000),
  boardId: boardIdSchema,
  statusId: statusIdSchema.optional(),
  tagIds: tagIdsSchema,
})

// Manually type since Zod's z.custom<T> doesn't properly infer branded types
interface EditPostInput {
  title: string
  content: string
  boardId: BoardId
  statusId?: StatusId
  tagIds: TagId[]
}

interface PostToEdit {
  id: PostId
  title: string
  content: string
  contentJson?: unknown
  statusId: StatusId | null
  board: { id: BoardId; name: string; slug: string }
  tags: { id: TagId; name: string; color: string }[]
}

interface EditPostDialogProps {
  post: PostToEdit
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onPostUpdated?: () => void
}

export function EditPostDialog({
  post,
  boards,
  tags,
  statuses,
  open,
  onOpenChange,
}: EditPostDialogProps) {
  const [error, setError] = useState('')

  // Use mutations for optimistic updates
  const updatePost = useUpdatePost()
  const updateTags = useUpdatePostTags()
  // Convert plain text to TipTap JSON format for posts without contentJson
  const getInitialContentJson = (post: PostToEdit): JSONContent | null => {
    if (post.contentJson) {
      return post.contentJson as JSONContent
    }
    // Fallback: convert plain text content to TipTap JSON
    if (post.content) {
      return {
        type: 'doc',
        content: post.content.split('\n').map((line) => ({
          type: 'paragraph',
          content: line ? [{ type: 'text', text: line }] : [],
        })),
      }
    }
    return null
  }

  const [contentJson, setContentJson] = useState<JSONContent | null>(getInitialContentJson(post))
  const lastPostIdRef = useRef(post.id)
  const wasOpenRef = useRef(false)

  const form = useForm<EditPostInput>({
    // Cast resolver since Zod's z.custom<T> doesn't properly infer branded types
    resolver: standardSchemaResolver(editPostSchema) as any,
    defaultValues: {
      title: post.title,
      content: post.content,
      boardId: post.board.id,
      statusId: post.statusId || undefined,
      tagIds: post.tags.map((t) => t.id),
    } as EditPostInput,
  })

  // Reset form when opening dialog (handles both new post and reopening same post)
  useEffect(() => {
    const isOpening = open && !wasOpenRef.current
    const isDifferentPost = post.id !== lastPostIdRef.current

    if (isOpening || isDifferentPost) {
      lastPostIdRef.current = post.id
      form.reset({
        title: post.title,
        content: post.content,
        boardId: post.board.id,
        statusId: post.statusId || undefined,
        tagIds: post.tags.map((t) => t.id),
      } as EditPostInput)
      setContentJson(getInitialContentJson(post))
    }

    wasOpenRef.current = open
  }, [open, post, form])

  const handleContentChange = useCallback(
    (json: JSONContent) => {
      setContentJson(json)
      const plainText = richTextToPlainText(json)
      form.setValue('content', plainText, { shouldValidate: true })
    },
    [form]
  )

  async function onSubmit(data: EditPostInput) {
    setError('')

    try {
      // Update post using mutation (handles optimistic updates)
      await updatePost.mutateAsync({
        postId: post.id as PostId,
        title: data.title,
        content: data.content,
        contentJson,
        statusId: data.statusId,
      })

      // Update tags separately if changed
      const currentTagIds = post.tags.map((t) => t.id).sort()
      const newTagIds = [...data.tagIds].sort()
      if (JSON.stringify(currentTagIds) !== JSON.stringify(newTagIds)) {
        await updateTags.mutateAsync({
          postId: post.id as PostId,
          tagIds: data.tagIds as string[],
          allTags: tags,
        })
      }

      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update post')
    }
  }

  function handleOpenChange(isOpen: boolean) {
    onOpenChange(isOpen)
    if (!isOpen) {
      setError('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Submit on Cmd/Ctrl + Enter
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      form.handleSubmit(onSubmit)()
    }
  }

  const selectedBoard = boards.find((b) => b.id === form.watch('boardId'))
  const selectedStatus = statuses.find((s) => s.id === form.watch('statusId'))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[95vw] max-w-3xl p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Edit post</DialogTitle>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            {/* Header row with board and status selectors */}
            <div className="flex items-center gap-4 pt-3 px-4 sm:px-6">
              <FormField
                control={form.control}
                name="boardId"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Board:</span>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger
                          size="xs"
                          className="border-0 bg-transparent shadow-none font-medium text-foreground hover:text-foreground/80 focus-visible:ring-0"
                        >
                          <SelectValue placeholder="Select board">
                            {selectedBoard?.name || 'Select board'}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent align="start">
                        {boards.map((board) => (
                          <SelectItem key={board.id} value={board.id} className="text-xs py-1">
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
                name="statusId"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Status:</span>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger
                          size="xs"
                          className="border-0 bg-transparent shadow-none font-medium text-foreground hover:text-foreground/80 focus-visible:ring-0"
                        >
                          <SelectValue>
                            {selectedStatus && (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: selectedStatus.color }}
                                />
                                {selectedStatus.name}
                              </div>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent align="start">
                        {statuses.map((status) => (
                          <SelectItem key={status.id} value={status.id} className="text-xs py-1">
                            <div className="flex items-center gap-1.5">
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

            <div className="px-4 sm:px-6 py-4 space-y-2">
              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive mb-4">
                  {error}
                </div>
              )}

              {/* Title - large, borderless input */}
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <input
                        type="text"
                        placeholder="What's the feedback about?"
                        className="w-full text-lg sm:text-xl font-semibold bg-transparent border-0 outline-none placeholder:text-muted-foreground/50 focus:ring-0"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Content - seamless rich text editor */}
              <FormField
                control={form.control}
                name="content"
                render={() => (
                  <FormItem>
                    <FormControl>
                      <RichTextEditor
                        value={contentJson || ''}
                        onChange={handleContentChange}
                        placeholder="Add more details..."
                        minHeight="200px"
                        borderless
                        toolbarPosition="bottom"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Tags */}
              {tags.length > 0 && (
                <Controller
                  control={form.control}
                  name="tagIds"
                  render={({ field }) => {
                    const selectedIds = field.value ?? []
                    return (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {tags.map((tag) => {
                          const isSelected = selectedIds.includes(tag.id)
                          return (
                            <Badge
                              key={tag.id}
                              variant="secondary"
                              className={`cursor-pointer text-xs font-normal transition-colors ${
                                isSelected
                                  ? 'bg-foreground text-background hover:bg-foreground/90'
                                  : 'hover:bg-muted/80'
                              }`}
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
                    )
                  }}
                />
              )}
            </div>

            <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t bg-muted/30">
              <p className="hidden sm:block text-xs text-muted-foreground">
                <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">⌘</kbd>
                <span className="mx-1">+</span>
                <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">Enter</kbd>
                <span className="ml-2">to save</span>
              </p>
              <div className="flex items-center gap-2 sm:ml-0 ml-auto">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={form.formState.isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? 'Saving...' : 'Save changes'}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
