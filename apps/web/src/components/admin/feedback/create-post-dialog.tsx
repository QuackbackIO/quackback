import { useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createPostSchema } from '@/lib/schemas/posts'
import { useCreatePost } from '@/lib/mutations/posts'
import type { CreatePostInput } from '@/lib/posts'
import { useSimilarPosts } from '@/lib/hooks/use-similar-posts'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PencilSquareIcon } from '@heroicons/react/24/solid'
import { richTextToPlainText } from '@/components/ui/rich-text-editor'
import { SimilarPostsCard } from '@/components/public/similar-posts-card'
import type { JSONContent } from '@tiptap/react'
import type { Board, Tag, PostStatusEntity } from '@/lib/db-types'
import { Form } from '@/components/ui/form'
import { PostFormFields } from './post-form-fields'

interface CreatePostDialogProps {
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  onPostCreated?: () => void
}

export function CreatePostDialog({ boards, tags, statuses, onPostCreated }: CreatePostDialogProps) {
  // Find the default status for new posts
  const defaultStatusId = statuses.find((s) => s.isDefault)?.id || statuses[0]?.id || ''
  const [open, setOpen] = useState(false)
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const createPostMutation = useCreatePost()

  const form = useForm({
    resolver: standardSchemaResolver(createPostSchema),
    defaultValues: {
      title: '',
      content: '',
      boardId: boards[0]?.id || '',
      statusId: defaultStatusId,
      tagIds: [] as string[],
    },
  })

  const handleContentChange = useCallback(
    (json: JSONContent) => {
      setContentJson(json)
      const plainText = richTextToPlainText(json)
      form.setValue('content', plainText, { shouldValidate: true })
    },
    [form]
  )

  // Handle form submission
  const handleSubmit = form.handleSubmit((data) => {
    createPostMutation.mutate(
      {
        title: data.title,
        content: data.content,
        boardId: data.boardId,
        statusId: data.statusId,
        tagIds: data.tagIds,
        contentJson,
      } as CreatePostInput,
      {
        onSuccess: () => {
          setOpen(false)
          form.reset()
          setContentJson(null)
          onPostCreated?.()
        },
      }
    )
  })

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
      handleSubmit()
    }
  }

  // Watch title for similar posts detection
  const watchedTitle = form.watch('title')
  const watchedBoardId = form.watch('boardId')

  // Find similar posts as admin types (for duplicate detection)
  const { posts: similarPosts } = useSimilarPosts({
    title: watchedTitle,
    enabled: open && !!watchedBoardId,
  })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Create new post">
          <PencilSquareIcon className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="w-[95vw] max-w-3xl p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Create new post</DialogTitle>

        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <PostFormFields
              form={form}
              boards={boards}
              statuses={statuses}
              tags={tags}
              contentJson={contentJson}
              onContentChange={handleContentChange}
              error={createPostMutation.isError ? createPostMutation.error.message : undefined}
            />

            {/* Similar posts card - shown above footer as pre-submit prompt */}
            <div className="px-4 sm:px-6">
              <SimilarPostsCard
                posts={similarPosts}
                show={watchedTitle.length >= 10}
                className="pt-2"
              />
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
