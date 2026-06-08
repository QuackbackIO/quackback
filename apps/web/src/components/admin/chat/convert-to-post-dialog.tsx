import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/solid'
import type { BoardId, ConversationId, PostId } from '@quackback/ids'
import {
  captureVisitorContactEmailFn,
  createPostFromConversationFn,
  sharePostFn,
} from '@/lib/server/functions/chat'
import { findSimilarPostsFn } from '@/lib/server/functions/public-posts'
import { adminQueries } from '@/lib/client/queries/admin'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
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
  /** Pre-select this board when the dialog opens (e.g. an AI suggestion's
   *  board). Falls back to the first board when unset or not a real board. */
  defaultBoardId?: string
  /** When the visitor is anonymous and has no contact email on file, offer an
   *  optional inline email field so post status updates can reach them. */
  visitorIsAnonymous?: boolean
  /** The visitor's contact email if already known (hides the capture field). */
  visitorContactEmail?: string | null
  onConverted?: () => void
  /** Controlled open state. Omit for an uncontrolled dialog with its own trigger. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Agent action: turn the conversation into a feedback post (new or upvote). */
export function ConvertToPostDialog({
  conversationId,
  defaultTitle,
  defaultContent,
  defaultBoardId,
  visitorIsAnonymous,
  visitorContactEmail,
  onConverted,
  open: controlledOpen,
  onOpenChange,
}: ConvertToPostDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [title, setTitle] = useState(defaultTitle)
  const [content, setContent] = useState(defaultContent)
  const [boardId, setBoardId] = useState<string>('')
  const [captureEmail, setCaptureEmail] = useState('')
  // Offer the optional email field only for an anonymous visitor with no email
  // on file — that's the only case a contact address is worth capturing.
  const showEmailCapture = Boolean(visitorIsAnonymous) && !visitorContactEmail

  // Reset the draft to the conversation's content each time the dialog opens.
  // A supplied defaultBoardId seeds the board too (validated against the loaded
  // boards in the effect below).
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle)
      setContent(defaultContent)
      setCaptureEmail('')
      if (defaultBoardId) setBoardId(defaultBoardId)
    }
  }, [open, defaultTitle, defaultContent, defaultBoardId])

  const { data: boards = [] } = useQuery(adminQueries.boards())
  // Default/repair the board selection: fall back to the first board when none
  // is chosen yet or the seeded id isn't a real board.
  useEffect(() => {
    if (boards.length === 0) return
    if (!boardId || !boards.some((b) => (b.id as string) === boardId)) {
      setBoardId(boards[0].id as string)
    }
  }, [boards, boardId])

  // Debounced dedupe: find existing posts similar to the draft title.
  const debouncedTitle = useDebouncedValue(title.trim(), 350)
  const { data: similar = [] } = useQuery({
    queryKey: ['admin', 'inbox', 'similar', debouncedTitle],
    queryFn: () => findSimilarPostsFn({ data: { title: debouncedTitle, limit: 4 } }),
    enabled: open && debouncedTitle.length >= 3,
    staleTime: 30_000,
  })

  const convert = useMutation({
    mutationFn: (vars: { asUpvoteOfPostId?: PostId; sourceMessageContent?: string }) =>
      createPostFromConversationFn({
        data: {
          conversationId,
          boardId: boardId as BoardId,
          title: title.trim(),
          content: content.trim() || undefined,
          asUpvoteOfPostId: vars.asUpvoteOfPostId,
          sourceMessageContent: vars.sourceMessageContent,
        },
      }),
    onSuccess: (res) => {
      toast.success(res.created ? 'Post created from conversation' : 'Upvoted existing post')
      setOpen(false)
      onConverted?.()
    },
    onError: () => toast.error('Failed to convert conversation'),
  })

  const share = useMutation({
    mutationFn: (postId: PostId) => sharePostFn({ data: { conversationId, postId } }),
    onSuccess: () => {
      toast.success('Post shared in chat')
      setOpen(false)
      onConverted?.()
    },
    onError: () => toast.error('Failed to share post'),
  })

  // Best-effort contact-email capture: fired alongside a track action and never
  // awaited or surfaced as an error, so a failed/ignored email can't block the
  // post. The server normalizes + ignores anything that isn't plausibly one.
  const captureContact = useMutation({
    mutationFn: (email: string) =>
      captureVisitorContactEmailFn({ data: { conversationId, email } }),
  })

  // Capture the typed email if non-empty; a no-op otherwise (non-blocking).
  // The server normalises + ignores anything that isn't plausibly an address.
  const maybeCaptureEmail = () => {
    const trimmed = captureEmail.trim()
    if (showEmailCapture && trimmed) captureContact.mutate(trimmed)
  }

  const busy = convert.isPending || share.isPending
  // Title must be at least 3 characters before the action enables.
  const canCreate = useMemo(() => title.trim().length >= 3 && boardId, [title, boardId])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /> Track as post
          </button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Track as a feedback post</DialogTitle>
          <DialogDescription>
            Create a post from this conversation, attributed to the customer — they'll see it in the
            chat and get status updates.
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

          {showEmailCapture && (
            <div className="space-y-1.5">
              <Label htmlFor="convert-contact-email">
                Capture an email so the visitor gets status updates (optional)
              </Label>
              <Input
                id="convert-contact-email"
                type="email"
                value={captureEmail}
                maxLength={320}
                placeholder="visitor@example.com"
                onChange={(e) => setCaptureEmail(e.target.value)}
              />
            </div>
          )}

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
                      disabled={busy}
                      onClick={() => {
                        maybeCaptureEmail()
                        convert.mutate({
                          asUpvoteOfPostId: p.id as PostId,
                          sourceMessageContent: defaultContent,
                        })
                      }}
                    >
                      <ChevronUpIcon className="h-3.5 w-3.5" /> Upvote
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => share.mutate(p.id as PostId)}
                    >
                      <ChatBubbleLeftRightIcon className="h-3.5 w-3.5" /> Share
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
            disabled={!canCreate || busy}
            onClick={() => {
              maybeCaptureEmail()
              convert.mutate({})
            }}
          >
            Track as post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
