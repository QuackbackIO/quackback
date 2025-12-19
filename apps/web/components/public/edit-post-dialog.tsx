'use client'

import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RichTextEditor, richTextToPlainText } from '@/components/ui/rich-text-editor'
import type { JSONContent } from '@tiptap/react'

interface EditPostDialogProps {
  postId: string
  initialTitle: string
  initialContent: string
  initialContentJson?: JSONContent | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function EditPostDialog({
  postId,
  initialTitle,
  initialContent,
  initialContentJson,
  open,
  onOpenChange,
  onSuccess,
}: EditPostDialogProps) {
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [title, setTitle] = useState(initialTitle)
  const [contentJson, setContentJson] = useState<JSONContent | null>(initialContentJson || null)

  // Reset form when dialog opens with new values
  useEffect(() => {
    if (open) {
      setTitle(initialTitle)
      setContentJson(initialContentJson || null)
      setError('')
    }
  }, [open, initialTitle, initialContentJson])

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
      const response = await fetch(`/api/public/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: plainText,
          contentJson,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update post')
      }

      onOpenChange(false)
      onSuccess?.()
      toast.success('Post updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update post')
    } finally {
      setIsSubmitting(false)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[95vw] max-w-3xl p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Edit post</DialogTitle>

        <div className="flex items-center pt-3 px-4 sm:px-6">
          <span className="text-sm font-medium text-foreground">Edit Post</span>
        </div>

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
            value={contentJson || initialContent}
            onChange={handleContentChange}
            placeholder="Add more details..."
            minHeight="200px"
            borderless
            toolbarPosition="bottom"
          />
        </div>

        <div className="flex items-center justify-end px-4 sm:px-6 py-3 border-t bg-muted/30">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
