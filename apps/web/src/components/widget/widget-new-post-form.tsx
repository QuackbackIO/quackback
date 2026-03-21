'use client'

import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWidgetAuth } from './widget-auth-provider'

interface WidgetNewPostFormProps {
  boards: { id: string; name: string; slug: string }[]
  prefilledTitle?: string
  selectedBoardSlug?: string
  onSuccess: (post: {
    id: string
    title: string
    voteCount: number
    statusId: string | null
    board: { id: string; name: string; slug: string }
  }) => void
  anonymousPostingEnabled?: boolean
}

export function WidgetNewPostForm({
  boards,
  prefilledTitle,
  selectedBoardSlug,
  onSuccess,
  anonymousPostingEnabled = false,
}: WidgetNewPostFormProps) {
  const { isIdentified, user, emitEvent, metadata } = useWidgetAuth()
  const canPost = isIdentified || anonymousPostingEnabled

  const defaultBoard = selectedBoardSlug
    ? boards.find((b) => b.slug === selectedBoardSlug)
    : boards[0]

  const [boardId, setBoardId] = useState(defaultBoard?.id ?? boards[0]?.id ?? '')
  const [title, setTitle] = useState(prefilledTitle ?? '')
  const [content, setContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  // Auto-focus: description if title is pre-filled, otherwise title
  useEffect(() => {
    const timer = setTimeout(() => {
      if (prefilledTitle) {
        descriptionRef.current?.focus()
      } else {
        titleRef.current?.focus()
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [prefilledTitle])

  if (!canPost) {
    const boardSlug = selectedBoardSlug || defaultBoard?.slug || boards[0]?.slug
    const portalUrl = boardSlug
      ? `${window.location.origin}/b/${boardSlug}`
      : window.location.origin

    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <p className="text-sm font-medium text-foreground">Want to share an idea?</p>
        <button
          type="button"
          onClick={() =>
            window.parent.postMessage({ type: 'quackback:navigate', url: portalUrl }, '*')
          }
          className="text-xs text-primary hover:text-primary/80 transition-colors mt-1"
        >
          Log in to submit your feedback
        </button>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !boardId || isSubmitting) return

    setIsSubmitting(true)
    setError(null)

    try {
      const { getWidgetAuthHeaders } = await import('@/lib/client/widget-auth')
      const { createPublicPostFn } = await import('@/lib/server/functions/public-posts')
      const result = await createPublicPostFn({
        data: {
          boardId,
          title: title.trim(),
          content: content.trim(),
          metadata: metadata ?? undefined,
        },
        headers: getWidgetAuthHeaders(),
      })

      emitEvent('post:created', {
        id: result.id,
        title: result.title,
        board: result.board,
        statusId: result.statusId ?? null,
      })

      onSuccess({
        id: result.id,
        title: result.title,
        voteCount: 0,
        statusId: result.statusId ?? null,
        board: result.board,
      })
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <ScrollArea className="flex-1 min-h-0 px-4 py-3 space-y-3">
        {boards.length > 1 && (
          <div>
            <label htmlFor="widget-board" className="text-xs font-medium text-muted-foreground">
              Board
            </label>
            <Select value={boardId} onValueChange={setBoardId}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <label htmlFor="widget-title" className="text-xs font-medium text-muted-foreground">
            Title
          </label>
          <input
            ref={titleRef}
            id="widget-title"
            type="text"
            placeholder="What's your idea?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className={`mt-1 ${inputClass}`}
          />
        </div>

        <div>
          <label htmlFor="widget-details" className="text-xs font-medium text-muted-foreground">
            Details (optional)
          </label>
          <textarea
            ref={descriptionRef}
            id="widget-details"
            placeholder="Add more details..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={10000}
            rows={4}
            className={`mt-1 ${inputClass} resize-none`}
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </ScrollArea>

      <div className="px-4 py-3 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
        <span className="text-xs text-muted-foreground truncate">
          {user ? `Posting as ${user.name || user.email}` : 'Posting anonymously'}
        </span>
        <button
          type="submit"
          disabled={!title.trim() || isSubmitting}
          className="px-4 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Submitting...' : 'Submit idea'}
        </button>
      </div>
    </form>
  )
}
