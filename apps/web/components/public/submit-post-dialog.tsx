'use client'

import type { BoardId } from '@quackback/ids'
import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus } from 'lucide-react'
import { RichTextEditor, richTextToPlainText } from '@/components/ui/rich-text-editor'
import { useCreatePublicPost } from '@/lib/hooks/use-public-posts-query'
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { useAuthBroadcast } from '@/lib/hooks/use-auth-broadcast'
import { useSession, signOut } from '@/lib/auth/client'
import type { JSONContent } from '@tiptap/react'

interface BoardOption {
  id: string
  name: string
  slug: string
}

interface SubmitPostDialogProps {
  boards: BoardOption[]
  defaultBoardId?: string
  onSuccess?: () => void
  trigger?: React.ReactNode
  /** User info if authenticated */
  user?: { name: string | null; email: string } | null
}

export function SubmitPostDialog({
  boards,
  defaultBoardId,
  onSuccess,
  trigger,
  user,
}: SubmitPostDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const { openAuthPopover } = useAuthPopover()

  // Use the mutation hook for optimistic updates
  const createPost = useCreatePublicPost()

  // Client-side session state - updates without page reload
  const { data: sessionData, refetch: refetchSession } = useSession()

  // Derive effective user: prefer fresh client session over stale server prop
  // When sessionData is undefined (loading), fall back to server prop
  const effectiveUser =
    sessionData === undefined
      ? user
      : sessionData?.user
        ? { name: sessionData.user.name, email: sessionData.user.email }
        : null

  // Listen for auth success to refetch session (no page reload)
  useAuthBroadcast({
    onSuccess: () => {
      refetchSession()
    },
    enabled: open, // Only listen when dialog is open
  })

  // Board selection - default to provided defaultBoardId or first board
  const [selectedBoardId, setSelectedBoardId] = useState(defaultBoardId || boards[0]?.id || '')

  // Sync selectedBoardId when defaultBoardId prop changes (e.g., URL filter change)
  useEffect(() => {
    if (defaultBoardId) {
      setSelectedBoardId(defaultBoardId)
    }
  }, [defaultBoardId])
  const [title, setTitle] = useState('')
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)

  const selectedBoard = boards.find((b) => b.id === selectedBoardId)

  const handleContentChange = useCallback((json: JSONContent) => {
    setContentJson(json)
  }, [])

  async function handleSubmit() {
    setError('')

    // Validation
    if (!selectedBoardId) {
      setError('Please select a board')
      return
    }

    if (!title.trim()) {
      setError('Please add a title')
      return
    }

    const plainText = contentJson ? richTextToPlainText(contentJson) : ''
    if (!plainText.trim()) {
      setError('Please add a description')
      return
    }

    try {
      const result = await createPost.mutateAsync({
        boardId: selectedBoardId as BoardId,
        title: title.trim(),
        content: plainText,
        contentJson,
      })

      setOpen(false)
      resetForm()
      onSuccess?.()

      // Show success toast with action to view the post
      toast.success('Feedback submitted', {
        action: {
          label: 'View',
          onClick: () => router.push(`/b/${result.board.slug}/posts/${result.id}`),
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    }
  }

  function resetForm() {
    setSelectedBoardId(defaultBoardId || boards[0]?.id || '')
    setTitle('')
    setContentJson(null)
    setError('')
  }

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      resetForm()
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Submit Feedback
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="w-[95vw] max-w-3xl p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Submit feedback</DialogTitle>

        {/* Board selector header - aligned with close button */}
        {boards.length > 0 && (
          <div className="flex items-center pt-3 px-4 sm:px-6">
            <span className="text-xs text-muted-foreground mr-1">Posting to</span>
            <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
              <SelectTrigger
                size="xs"
                className="border-0 bg-transparent shadow-none font-medium text-foreground hover:text-foreground/80 focus-visible:ring-0"
              >
                <SelectValue placeholder="Select board">
                  {selectedBoard?.name || 'Select board'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                {boards.map((board) => (
                  <SelectItem key={board.id} value={board.id} className="text-xs py-1">
                    {board.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="px-4 sm:px-6 py-4 space-y-2">
          {error && (
            <div className="[border-radius:calc(var(--radius)*0.8)] bg-destructive/10 px-3 py-2 text-sm text-destructive mb-4">
              {error}
            </div>
          )}

          {/* Title - large, borderless input */}
          <input
            type="text"
            placeholder="What's your idea?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-lg sm:text-xl font-semibold bg-transparent border-0 outline-none placeholder:text-muted-foreground/50 focus:ring-0"
            autoFocus
          />

          {/* Content - seamless rich text editor */}
          <RichTextEditor
            value={contentJson || ''}
            onChange={handleContentChange}
            placeholder="Add more details..."
            minHeight="200px"
            borderless
            toolbarPosition="bottom"
          />
        </div>

        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t bg-muted/30">
          {effectiveUser ? (
            <p className="text-xs text-muted-foreground">
              Posting as{' '}
              <span className="font-medium text-foreground">
                {effectiveUser.name || effectiveUser.email}
              </span>
              {' ('}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        refetchSession()
                      },
                    },
                  })
                }}
              >
                sign out
              </button>
              {')'}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => openAuthPopover({ mode: 'login' })}
              className="text-xs text-primary hover:underline font-medium"
            >
              Sign in to post
            </button>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={createPost.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={createPost.isPending || !effectiveUser}
              title={!effectiveUser ? 'Please sign in to submit feedback' : undefined}
            >
              {createPost.isPending ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
