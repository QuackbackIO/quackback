import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/solid'
import type { ConversationId, PostId } from '@quackback/ids'
import { sharePostFn } from '@/lib/server/functions/conversation'
import { findSimilarPostsFn } from '@/lib/server/functions/public-posts'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SharePostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: ConversationId
  onShared?: () => void
}

/** Agent action: search existing posts and embed one as a card in the chat. */
export function SharePostDialog({
  open,
  onOpenChange,
  conversationId,
  onShared,
}: SharePostDialogProps) {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim(), 350)

  // Clear the query when the dialog closes so a fresh open starts empty.
  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const { data: results = [] } = useQuery({
    queryKey: ['admin', 'inbox', 'share-search', debounced],
    queryFn: () => findSimilarPostsFn({ data: { title: debounced, limit: 6 } }),
    enabled: open && debounced.length >= 3,
    staleTime: 30_000,
  })

  const share = useMutation({
    mutationFn: (postId: PostId) => sharePostFn({ data: { conversationId, postId } }),
    onSuccess: () => {
      toast.success('Post shared in chat')
      onOpenChange(false)
      onShared?.()
    },
    onError: () => toast.error('Failed to share post'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share a post</DialogTitle>
          <DialogDescription>Search for an existing post to embed in this chat.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={search}
            placeholder="Search posts by title…"
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="flex flex-col gap-1">
            {results.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm">{p.title}</span>
                <span className="text-xs text-muted-foreground">{p.voteCount}▲</span>
                {p.status && (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    {p.status.name}
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={share.isPending}
                  onClick={() => share.mutate(p.id as PostId)}
                >
                  <ChatBubbleLeftRightIcon className="h-3.5 w-3.5" /> Share
                </Button>
              </div>
            ))}
            {debounced.length >= 3 && results.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">No matching posts</p>
            )}
            {debounced.length < 3 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Type at least 3 characters to search.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
