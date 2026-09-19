import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowTopRightOnSquareIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import type { PostId } from '@quackback/ids'
import { publishCaptureToBoardFn } from '@/lib/server/functions/conversation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface InternalCaptureBarProps {
  postId: PostId
  /** The post's audience. The bar renders nothing for a board post. */
  audience: string | null | undefined
  /** Display name of whoever captured it. */
  capturedByName: string | null
  /** The conversation this was captured from, when there is one. */
  sourceConversationId: string | null
  /** Current title and body, seeded into the publish review. */
  title: string
  content: string
  /** Only a teammate holding post.approve may publish. */
  canPublish: boolean
  onPublished?: () => void
}

/**
 * The one row an internal capture adds to the feedback detail: who recorded
 * it, where it came from, and the reviewed way out to a board.
 *
 * Deliberately a single line. The audience is already the reason the post is
 * here, so it does not also need a paragraph explaining itself, and the
 * publish review is a dialog rather than inline fields because what becomes
 * public is a decision, not an edit.
 */
export function InternalCaptureBar({
  postId,
  audience,
  capturedByName,
  sourceConversationId,
  title,
  content,
  canPublish,
  onPublished,
}: InternalCaptureBarProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reviewedTitle, setReviewedTitle] = useState(title)
  const [reviewedContent, setReviewedContent] = useState(content)

  const publish = useMutation({
    mutationFn: () =>
      publishCaptureToBoardFn({
        data: { postId, title: reviewedTitle.trim(), content: reviewedContent.trim() },
      }),
    onSuccess: () => {
      toast.success('Published to the board')
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
      onPublished?.()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to publish'),
  })

  if (audience !== 'internal') return null

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
      <LockClosedIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium">Internal</span>
      <span className="text-muted-foreground">
        {capturedByName ? `Captured by ${capturedByName}` : 'Captured'}
      </span>
      {sourceConversationId && (
        <a
          href={`/admin/inbox?i=${sourceConversationId}`}
          className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-primary"
        >
          from a conversation
          <ArrowTopRightOnSquareIcon className="h-3 w-3" />
        </a>
      )}
      {canPublish && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-7"
          onClick={() => {
            setReviewedTitle(title)
            setReviewedContent(content)
            setOpen(true)
          }}
        >
          Publish to board
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Publish to board</DialogTitle>
            <DialogDescription>
              Only the title and details below become visible. The conversation link and private
              comments stay internal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="publish-title">Title</Label>
              <Input
                id="publish-title"
                value={reviewedTitle}
                maxLength={200}
                onChange={(e) => setReviewedTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="publish-content">Details</Label>
              <Textarea
                id="publish-content"
                value={reviewedContent}
                maxLength={10000}
                rows={5}
                onChange={(e) => setReviewedContent(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={reviewedTitle.trim().length < 3 || publish.isPending}
              onClick={() => publish.mutate()}
            >
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
