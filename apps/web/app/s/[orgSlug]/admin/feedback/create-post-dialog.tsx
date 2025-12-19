'use client'

import { useState, useCallback } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createPostSchema, type CreatePostInput } from '@/lib/schemas/posts'
import { useCreatePost } from '@/lib/hooks/use-inbox-queries'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { PenSquare } from 'lucide-react'
import { RichTextEditor, richTextToPlainText } from '@/components/ui/rich-text-editor'
import type { JSONContent } from '@tiptap/react'
import type { Board, Tag, PostStatusEntity } from '@/lib/db/types'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'

interface CreatePostDialogProps {
  workspaceId: string
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  onPostCreated?: () => void
}

export function CreatePostDialog({
  workspaceId,
  boards,
  tags,
  statuses,
  onPostCreated,
}: CreatePostDialogProps) {
  // Find the default status for new posts
  const defaultStatusId = statuses.find((s) => s.isDefault)?.id || statuses[0]?.id || ''
  const [open, setOpen] = useState(false)
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const createPostMutation = useCreatePost(workspaceId)

  const form = useForm<CreatePostInput>({
    // Cast resolver since Zod's z.custom<T> doesn't properly infer branded types
    resolver: standardSchemaResolver(createPostSchema) as any,
    defaultValues: {
      title: '',
      content: '',
      boardId: boards[0]?.id || '',
      statusId: defaultStatusId,
      tagIds: [],
    } as CreatePostInput,
  })

  const handleContentChange = useCallback(
    (json: JSONContent) => {
      setContentJson(json)
      const plainText = richTextToPlainText(json)
      form.setValue('content', plainText, { shouldValidate: true })
    },
    [form]
  )

  function onSubmit(data: CreatePostInput) {
    createPostMutation.mutate(
      { ...data, contentJson },
      {
        onSuccess: () => {
          setOpen(false)
          form.reset()
          setContentJson(null)
          onPostCreated?.()
        },
      }
    )
  }

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      form.reset()
      setContentJson(null)
      createPostMutation.reset()
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
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Create new post">
          <PenSquare className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="w-[95vw] max-w-3xl p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Create new post</DialogTitle>

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
              {createPostMutation.isError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive mb-4">
                  {createPostMutation.error.message}
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
                <span className="ml-2">to create</span>
              </p>
              <div className="flex items-center gap-2 sm:ml-0 ml-auto">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  disabled={createPostMutation.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={createPostMutation.isPending}>
                  {createPostMutation.isPending ? 'Creating...' : 'Create post'}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
