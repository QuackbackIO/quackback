import { useState, useCallback } from 'react'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { ModalFooter } from '@/components/shared/modal-footer'
import { useForm, Controller } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createPostSchema } from '@/lib/shared/schemas/posts'
import { useCreatePost } from '@/lib/client/mutations/posts'
import type { CreatePostInput } from '@/lib/server/domains/posts'
import { useSimilarPosts } from '@/lib/client/hooks/use-similar-posts'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FolderIcon, TagIcon, UserIcon } from '@heroicons/react/24/outline'
import { PencilSquareIcon } from '@heroicons/react/24/solid'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { SimilarPostsCard } from '@/components/public/similar-posts-card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { FormError } from '@/components/shared/form-error'
import { TitleInput } from '@/components/shared/title-input'
import { AuthorSelector, type NewAuthor } from '@/components/shared/author-selector'
import { useCreatePortalUser, useUpdatePortalUser } from '@/lib/client/mutations'
import { cn } from '@/lib/shared/utils'
import type { JSONContent } from '@tiptap/react'
import type { Board, Tag, PostStatusEntity } from '@/lib/shared/db-types'
import type { CurrentUser } from '@/lib/shared/types/inbox'
import { Form } from '@/components/ui/form'

interface CreatePostDialogProps {
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  currentUser: CurrentUser
  onPostCreated?: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
}

export function CreatePostDialog({
  boards,
  tags,
  statuses,
  currentUser,
  onPostCreated,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  trigger,
}: CreatePostDialogProps) {
  const defaultStatusId = statuses.find((s) => s.isDefault)?.id || statuses[0]?.id || ''
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [authorPrincipalId, setAuthorPrincipalId] = useState(currentUser.principalId)
  const createPostMutation = useCreatePost()
  const createUserMutation = useCreatePortalUser()
  const updateUserMutation = useUpdatePortalUser()
  const handleCreateUser = async (data: { name: string; email?: string }): Promise<NewAuthor> => {
    const result = await createUserMutation.mutateAsync(data)
    return result
  }
  const handleEditUser = async (data: {
    principalId: string
    name: string
    email?: string
  }): Promise<NewAuthor> => {
    await updateUserMutation.mutateAsync({
      principalId: data.principalId,
      name: data.name,
      email: data.email || undefined,
    })
    return { principalId: data.principalId, name: data.name, email: data.email || null }
  }
  const userMutationPending = createUserMutation.isPending || updateUserMutation.isPending

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
    (json: JSONContent, _html: string, markdown: string) => {
      setContentJson(json)
      form.setValue('content', markdown, { shouldValidate: true })
    },
    [form]
  )

  const handleSubmit = form.handleSubmit((data) => {
    createPostMutation.mutate(
      {
        title: data.title,
        content: data.content,
        boardId: data.boardId,
        statusId: data.statusId,
        tagIds: data.tagIds,
        contentJson,
        authorPrincipalId,
      } as CreatePostInput & { authorPrincipalId?: string },
      {
        onSuccess: () => {
          setOpen(false)
          form.reset()
          setContentJson(null)
          setAuthorPrincipalId(currentUser.principalId)
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
      setAuthorPrincipalId(currentUser.principalId)
      createPostMutation.reset()
    }
  }

  const handleKeyDown = useKeyboardSubmit(handleSubmit)

  const watchedTitle = form.watch('title')
  const watchedBoardId = form.watch('boardId')
  const watchedStatusId = form.watch('statusId')

  const { posts: similarPosts } = useSimilarPosts({
    title: watchedTitle,
    enabled: open && !!watchedBoardId,
  })

  const selectedBoard = boards.find((b) => b.id === watchedBoardId)
  const selectedStatus = statuses.find((s) => s.id === watchedStatusId)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" title="Create new post">
            <PencilSquareIcon className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="w-[95vw] max-w-5xl p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Create new post</DialogTitle>

        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <div className="flex min-h-[420px]">
              {/* Left column: Title + Content */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="px-4 sm:px-6 py-4 space-y-2 flex-1">
                  {createPostMutation.isError && (
                    <FormError
                      message={createPostMutation.error.message}
                      className="px-3 py-2 mb-4"
                    />
                  )}

                  <TitleInput
                    control={form.control}
                    placeholder="What's the feedback about?"
                    autoFocus
                  />

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
                            features={{
                              headings: true,
                              codeBlocks: true,
                              taskLists: true,
                              blockquotes: true,
                              dividers: true,
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Similar posts card */}
                <div className="px-4 sm:px-6">
                  <SimilarPostsCard
                    posts={similarPosts}
                    show={watchedTitle.length >= 10}
                    className="pt-2"
                  />
                </div>
              </div>

              {/* Right sidebar: Metadata (lg+) */}
              <aside className="hidden lg:block w-64 shrink-0 border-l border-border/30 bg-muted/5">
                <div className="p-4 space-y-5">
                  {/* Author */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <UserIcon className="h-4 w-4" />
                      <span>Author</span>
                    </div>
                    <AuthorSelector
                      value={authorPrincipalId}
                      onChange={setAuthorPrincipalId}
                      fallbackName={currentUser.name}
                      onCreateUser={handleCreateUser}
                      onEditUser={handleEditUser}
                      isCreating={userMutationPending}
                    />
                  </div>

                  {/* Board */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FolderIcon className="h-4 w-4" />
                      <span>Board</span>
                    </div>
                    <FormField
                      control={form.control}
                      name="boardId"
                      render={({ field }) => (
                        <FormItem>
                          <Select onValueChange={field.onChange} value={field.value as string}>
                            <FormControl>
                              <SelectTrigger size="sm" className="w-full text-xs">
                                <SelectValue placeholder="Select board">
                                  {selectedBoard?.name || 'Select board'}
                                </SelectValue>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {boards.map((board) => (
                                <SelectItem key={board.id} value={board.id} className="text-xs">
                                  {board.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Status */}
                  <div className="space-y-1.5">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <FormField
                      control={form.control}
                      name="statusId"
                      render={({ field }) => (
                        <FormItem>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value as string | undefined}
                          >
                            <FormControl>
                              <SelectTrigger size="sm" className="w-full text-xs">
                                <SelectValue>
                                  {selectedStatus && (
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className="h-2 w-2 rounded-full shrink-0"
                                        style={{ backgroundColor: selectedStatus.color }}
                                      />
                                      {selectedStatus.name}
                                    </div>
                                  )}
                                </SelectValue>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {statuses.map((status) => (
                                <SelectItem key={status.id} value={status.id} className="text-xs">
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

                  {/* Tags */}
                  {tags.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <TagIcon className="h-4 w-4" />
                        <span>Tags</span>
                      </div>
                      <Controller
                        control={form.control}
                        name="tagIds"
                        render={({ field }) => {
                          const selectedIds = (field.value ?? []) as string[]
                          return (
                            <div className="flex flex-wrap gap-1">
                              {tags.map((tag) => {
                                const isSelected = selectedIds.includes(tag.id)
                                return (
                                  <Badge
                                    key={tag.id}
                                    variant="secondary"
                                    className={cn(
                                      'cursor-pointer text-[11px] font-normal transition-colors',
                                      isSelected
                                        ? 'bg-foreground text-background hover:bg-foreground/90'
                                        : 'hover:bg-muted/80'
                                    )}
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
                    </div>
                  )}
                </div>
              </aside>
            </div>

            {/* Inline metadata strip (below lg) */}
            <div className="lg:hidden border-t border-border/30 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <AuthorSelector
                  value={authorPrincipalId}
                  onChange={setAuthorPrincipalId}
                  fallbackName={currentUser.name}
                  onCreateUser={handleCreateUser}
                  onEditUser={handleEditUser}
                  isCreating={userMutationPending}
                />
                <FormField
                  control={form.control}
                  name="boardId"
                  render={({ field }) => (
                    <FormItem className="flex-none">
                      <Select onValueChange={field.onChange} value={field.value as string}>
                        <FormControl>
                          <SelectTrigger size="sm" className="text-xs">
                            <FolderIcon className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                            <SelectValue placeholder="Board">
                              {selectedBoard?.name || 'Board'}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {boards.map((board) => (
                            <SelectItem key={board.id} value={board.id} className="text-xs">
                              {board.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="statusId"
                  render={({ field }) => (
                    <FormItem className="flex-none">
                      <Select
                        onValueChange={field.onChange}
                        value={field.value as string | undefined}
                      >
                        <FormControl>
                          <SelectTrigger size="sm" className="text-xs">
                            <SelectValue placeholder="Status">
                              {selectedStatus && (
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="h-2 w-2 rounded-full shrink-0"
                                    style={{ backgroundColor: selectedStatus.color }}
                                  />
                                  {selectedStatus.name}
                                </div>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {statuses.map((status) => (
                            <SelectItem key={status.id} value={status.id} className="text-xs">
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
                    </FormItem>
                  )}
                />
                {tags.length > 0 && (
                  <Controller
                    control={form.control}
                    name="tagIds"
                    render={({ field }) => {
                      const selectedIds = (field.value ?? []) as string[]
                      return (
                        <div className="flex flex-wrap gap-1">
                          {tags.map((tag) => {
                            const isSelected = selectedIds.includes(tag.id)
                            return (
                              <Badge
                                key={tag.id}
                                variant="secondary"
                                className={cn(
                                  'cursor-pointer text-[11px] font-normal transition-colors',
                                  isSelected
                                    ? 'bg-foreground text-background hover:bg-foreground/90'
                                    : 'hover:bg-muted/80'
                                )}
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
            </div>

            <ModalFooter
              onCancel={() => setOpen(false)}
              submitLabel={createPostMutation.isPending ? 'Creating...' : 'Create post'}
              isPending={createPostMutation.isPending}
              hintAction="to create"
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
