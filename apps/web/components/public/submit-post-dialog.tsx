'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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
}

export function SubmitPostDialog({
  boards,
  defaultBoardId,
  onSuccess,
  trigger,
}: SubmitPostDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

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

    setIsSubmitting(true)

    try {
      const response = await fetch(`/api/public/boards/${selectedBoardId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: plainText,
          contentJson,
        }),
      })

      if (!response.ok) {
        const responseData = await response.json()
        throw new Error(responseData.error || 'Failed to submit feedback')
      }

      setOpen(false)
      resetForm()
      router.refresh()
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    } finally {
      setIsSubmitting(false)
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
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive mb-4">
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
          <p className="hidden sm:block text-xs text-muted-foreground">
            <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">⌘</kbd>
            <span className="mx-1">+</span>
            <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">Enter</kbd>
            <span className="ml-2">to submit</span>
          </p>
          <div className="flex items-center gap-2 sm:ml-0 ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
