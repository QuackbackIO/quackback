import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ConversationId, PostId } from '@quackback/ids'
import { findSimilarPostsFn } from '@/lib/server/functions/public-posts'
import { linkConversationToPostFn } from '@/lib/server/functions/post-followup'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'

interface LinkCaptureDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The conversation this capture came from: the evidence being attached. */
  conversationId: ConversationId
  onLinked?: () => void
}

/**
 * Attach a capture's conversation to an existing board post as evidence.
 *
 * The alternative to merging. A merge would roll this record onto the board
 * post, and a capture cannot cross that boundary; a link says the same
 * customer asked for the same thing, casts no vote, and leaves the private
 * record where it is.
 */
export function LinkCaptureDialog({
  open,
  onOpenChange,
  conversationId,
  onLinked,
}: LinkCaptureDialogProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim(), 350)

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const { data: results = [] } = useQuery({
    queryKey: ['admin', 'feedback', 'link-search', debounced],
    queryFn: () => findSimilarPostsFn({ data: { title: debounced, limit: 6 } }),
    enabled: open && debounced.length >= 3,
    staleTime: 30_000,
  })

  const link = useMutation({
    mutationFn: (postId: PostId) => linkConversationToPostFn({ data: { conversationId, postId } }),
    onSuccess: () => {
      toast.success('Linked as evidence')
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
      onLinked?.()
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'That could not be linked'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link to an existing request</DialogTitle>
          <DialogDescription>
            The conversation joins that request as evidence. Nothing here becomes public and no vote
            is cast.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search requests"
            aria-label="Search requests"
          />
          {debounced.length < 3 ? (
            <p className="text-sm text-muted-foreground">Type at least 3 characters to search.</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching requests.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {results.map((post) => (
                <li key={post.id} className="flex items-center gap-3 p-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{post.title}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={link.isPending}
                    onClick={() => link.mutate(post.id as PostId)}
                  >
                    Link
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
