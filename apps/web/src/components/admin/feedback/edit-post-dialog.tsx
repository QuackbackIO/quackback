import { useState, useCallback, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { editPostSchema } from '@/lib/schemas/posts'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { richTextToPlainText } from '@/components/ui/rich-text-editor'
import { useUpdatePost, useUpdatePostTags } from '@/lib/mutations/posts'
import type { JSONContent } from '@tiptap/react'
import type { Board, Tag, PostStatusEntity } from '@/lib/db-types'
import type { BoardId, PostId, StatusId, TagId } from '@quackback/ids'
import { Form } from '@/components/ui/form'
import type { AdminEditPostInput } from '@/lib/posts'
import { PostFormFields } from './post-form-fields'

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

  const form = useForm({
    resolver: standardSchemaResolver(editPostSchema),
    defaultValues: {
      title: post.title,
      content: post.content,
      boardId: post.board.id as string,
      statusId: (post.statusId || undefined) as string | undefined,
      tagIds: post.tags.map((t) => t.id) as string[],
    },
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
        boardId: post.board.id as string,
        statusId: (post.statusId || undefined) as string | undefined,
        tagIds: post.tags.map((t) => t.id) as string[],
      })
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

  // Handle form submission
  const handleSubmit = form.handleSubmit(async (data) => {
    setError('')
    const input = { postId: post.id, ...data } as AdminEditPostInput

    try {
      // Check if tags need updating
      const currentTagIds = post.tags.map((t) => t.id).sort()
      const newTagIds = [...input.tagIds].sort()
      const tagsChanged = JSON.stringify(currentTagIds) !== JSON.stringify(newTagIds)

      // Run mutations in parallel for better performance
      const mutations: Promise<unknown>[] = [
        updatePost.mutateAsync({
          postId: post.id as PostId,
          title: input.title,
          content: input.content,
          contentJson,
          statusId: input.statusId,
        }),
      ]

      if (tagsChanged) {
        mutations.push(
          updateTags.mutateAsync({
            postId: post.id as PostId,
            tagIds: input.tagIds as string[],
            allTags: tags,
          })
        )
      }

      await Promise.all(mutations)

      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update post')
    }
  })

  function handleOpenChangeLocal(isOpen: boolean) {
    onOpenChange(isOpen)
    if (!isOpen) {
      setError('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Submit on Cmd/Ctrl + Enter
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChangeLocal}>
      <DialogContent
        className="w-[95vw] max-w-3xl p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Edit post</DialogTitle>

        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <PostFormFields
              form={form}
              boards={boards}
              statuses={statuses}
              tags={tags}
              contentJson={contentJson}
              onContentChange={handleContentChange}
              error={error}
            />

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
