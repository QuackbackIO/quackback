'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { RichTextEditor, richTextToPlainText } from '@/components/ui/rich-text-editor'
import type { JSONContent } from '@tiptap/react'

interface SubmitPostDialogProps {
  boardId: string
  onSuccess?: () => void
  trigger?: React.ReactNode
}

export function SubmitPostDialog({ boardId, onSuccess, trigger }: SubmitPostDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [title, setTitle] = useState('')
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)

  const handleContentChange = useCallback((json: JSONContent) => {
    setContentJson(json)
  }, [])

  async function handleSubmit() {
    setError('')

    // Validation
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
      const response = await fetch(`/api/public/boards/${boardId}/posts`, {
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
        <div className="p-4 sm:p-6 space-y-2">
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
