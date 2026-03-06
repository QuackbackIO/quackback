import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
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
import {
  FolderIcon,
  TagIcon,
  UserIcon,
  ChevronUpDownIcon,
  CheckIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import { PencilSquareIcon } from '@heroicons/react/24/solid'
import { richTextToPlainText, RichTextEditor } from '@/components/ui/rich-text-editor'
import { SimilarPostsCard } from '@/components/public/similar-posts-card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { FormError } from '@/components/shared/form-error'
import { TitleInput } from '@/components/shared/title-input'
import { cn, getInitials } from '@/lib/shared/utils'
import type { JSONContent } from '@tiptap/react'
import type { Board, Tag, PostStatusEntity } from '@/lib/shared/db-types'
import type { TeamMember } from '@/lib/server/domains/principals'
import type { CurrentUser } from '@/lib/shared/types/inbox'
import { Form } from '@/components/ui/form'

interface CreatePostDialogProps {
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  members: TeamMember[]
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
  members,
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

  const { posts: similarPosts } = useSimilarPosts({
    title: watchedTitle,
    enabled: open && !!watchedBoardId,
  })

  const selectedBoard = boards.find((b) => b.id === form.watch('boardId'))
  const selectedStatus = statuses.find((s) => s.id === form.watch('statusId'))

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

              {/* Right sidebar: Metadata */}
              <aside className="hidden lg:block w-64 shrink-0 border-l border-border/30 bg-muted/5">
                <div className="p-4 space-y-5">
                  {/* Author */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <UserIcon className="h-4 w-4" />
                      <span>Author</span>
                    </div>
                    <AuthorSelector
                      members={members}
                      currentUser={currentUser}
                      value={authorPrincipalId}
                      onChange={setAuthorPrincipalId}
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

// ============================================================================
// Author Selector (searchable popover)
// ============================================================================

interface AuthorSelectorProps {
  members: TeamMember[]
  currentUser: CurrentUser
  value: string
  onChange: (principalId: string) => void
}

function AuthorSelector({ members, currentUser, value, onChange }: AuthorSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      // Focus the search input when popover opens
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setSearch('')
    }
  }, [open])

  const selectedMember = members.find((m) => m.id === value)
  const selectedName = selectedMember?.name || currentUser.name

  const filtered = useMemo(() => {
    if (!search.trim()) return members
    const q = search.toLowerCase()
    return members.filter(
      (m) => m.name?.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    )
  }, [members, search])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left',
            'border border-border/50 hover:border-border hover:bg-muted/40',
            'transition-all duration-150 text-xs'
          )}
        >
          <Avatar className="h-5 w-5 shrink-0">
            {selectedMember?.image && (
              <AvatarImage src={selectedMember.image} alt={selectedName || ''} />
            )}
            <AvatarFallback className="text-[9px]">{getInitials(selectedName)}</AvatarFallback>
          </Avatar>
          <span className="truncate font-medium text-foreground">
            {selectedName || 'Anonymous'}
          </span>
          <ChevronUpDownIcon className="h-3.5 w-3.5 text-muted-foreground/60 ml-auto shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" sideOffset={4}>
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
          <MagnifyingGlassIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members..."
            className="flex-1 text-xs bg-transparent border-0 outline-none placeholder:text-muted-foreground/50"
          />
        </div>
        {/* Member list */}
        <div className="max-h-56 overflow-y-auto p-1 scrollbar-thin">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 text-center py-4">No members found</p>
          ) : (
            filtered.map((member) => {
              const isSelected = member.id === value
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => {
                    onChange(member.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left',
                    'text-xs transition-colors duration-100',
                    isSelected
                      ? 'bg-primary/10 text-foreground'
                      : 'text-foreground/80 hover:bg-muted/60'
                  )}
                >
                  <Avatar className="h-5 w-5 shrink-0">
                    {member.image && <AvatarImage src={member.image} alt={member.name || ''} />}
                    <AvatarFallback className="text-[9px]">
                      {getInitials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{member.name || 'Unnamed'}</div>
                    <div className="text-muted-foreground/60 truncate">{member.email}</div>
                  </div>
                  {isSelected && <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
