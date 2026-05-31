import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowTopRightOnSquareIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import type { BoardId, ConversationId, PostId } from '@quackback/ids'
import { convertChatToPostFn } from '@/lib/server/functions/chat'
import { findSimilarPostsFn } from '@/lib/server/functions/public-posts'
import { adminQueries } from '@/lib/client/queries/admin'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ConvertToPostDialogProps {
  conversationId: ConversationId
  defaultTitle: string
  defaultContent: string
  onConverted?: () => void
}

/** Agent action: turn the conversation into a feedback post (new or upvote). */
export function ConvertToPostDialog({
  conversationId,
  defaultTitle,
  defaultContent,
  onConverted,
}: ConvertToPostDialogProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(defaultTitle)
  const [content, setContent] = useState(defaultContent)
  const [boardId, setBoardId] = useState<string>('')

  // Reset the draft to the conversation's content each time the dialog opens.
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle)
      setContent(defaultContent)
    }
  }, [open, defaultTitle, defaultContent])

  const { data: boards = [] } = useQuery(adminQueries.boards())
  useEffect(() => {
    if (!boardId && boards.length > 0) setBoardId(boards[0].id as string)
  }, [boards, boardId])

  // Debounced dedupe: find existing posts similar to the draft title.
  const [debouncedTitle, setDebouncedTitle] = useState(defaultTitle)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTitle(title.trim()), 350)
    return () => clearTimeout(t)
  }, [title])
  const { data: similar = [] } = useQuery({
    queryKey: ['admin', 'chat', 'similar', debouncedTitle],
    queryFn: () => findSimilarPostsFn({ data: { title: debouncedTitle, limit: 4 } }),
    enabled: open && debouncedTitle.length >= 3,
    staleTime: 30_000,
  })

  const convert = useMutation({
    mutationFn: (vars: { asUpvoteOfPostId?: PostId }) =>
      convertChatToPostFn({
        data: {
          conversationId,
          boardId: boardId as BoardId,
          title: title.trim(),
          content: content.trim() || undefined,
          asUpvoteOfPostId: vars.asUpvoteOfPostId,
        },
      }),
    onSuccess: (res) => {
      toast.success(res.created ? 'Post created from conversation' : 'Upvoted existing post')
      setOpen(false)
      onConverted?.()
    },
    onError: () => toast.error('Failed to convert conversation'),
  })

  const canCreate = useMemo(() => title.trim().length > 0 && boardId, [title, boardId])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /> Create post
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create feedback post</DialogTitle>
          <DialogDescription>
            Turn this conversation into a post, attributed to the visitor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="convert-board">Board</Label>
            <Select value={boardId} onValueChange={setBoardId}>
              <SelectTrigger id="convert-board">
                <SelectValue placeholder="Select a board" />
              </SelectTrigger>
              <SelectContent>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id as string}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="convert-title">Title</Label>
            <Input
              id="convert-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="convert-content">Details</Label>
            <Textarea
              id="convert-content"
              value={content}
              maxLength={10000}
              rows={4}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>

          {similar.length > 0 && (
            <div className="rounded-lg border border-border/60 p-2.5">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Similar posts — upvote instead of creating a duplicate?
              </p>
              <div className="flex flex-col gap-1">
                {similar.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm">{p.title}</span>
                    <span className="text-xs text-muted-foreground">{p.voteCount}▲</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={convert.isPending}
                      onClick={() => convert.mutate({ asUpvoteOfPostId: p.id as PostId })}
                    >
                      <ChevronUpIcon className="h-3.5 w-3.5" /> Upvote
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canCreate || convert.isPending}
            onClick={() => convert.mutate({})}
          >
            Create post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
