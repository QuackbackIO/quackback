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
  hmacRequired?: boolean
}

export function WidgetNewPostForm({
  boards,
  prefilledTitle,
  selectedBoardSlug,
  onSuccess,
  anonymousPostingEnabled = false,
  hmacRequired = false,
}: WidgetNewPostFormProps) {
  const { isIdentified, user, emitEvent, metadata, ensureSession, identifyWithEmail } =
    useWidgetAuth()
  const canPost = isIdentified || anonymousPostingEnabled

  // When HMAC is on and user can't post, show the redirect gate
  if (!canPost && hmacRequired) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <p className="text-sm font-medium text-foreground">Want to share an idea?</p>
        <button
          type="button"
          onClick={() =>
            window.parent.postMessage(
              { type: 'quackback:navigate', url: `${window.location.origin}/auth/login` },
              '*'
            )
          }
          className="text-xs text-primary hover:text-primary/80 transition-colors mt-1"
        >
          Log in to submit your feedback
        </button>
      </div>
    )
  }

  // Show email/name fields when user isn't identified and HMAC is off
  const needsEmail = !isIdentified && !hmacRequired && !anonymousPostingEnabled

  const defaultBoard = selectedBoardSlug
    ? boards.find((b) => b.slug === selectedBoardSlug)
    : boards[0]

  const [boardId, setBoardId] = useState(defaultBoard?.id ?? boards[0]?.id ?? '')
  const [title, setTitle] = useState(prefilledTitle ?? '')
  const [content, setContent] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !boardId || isSubmitting) return
    if (needsEmail && !email.trim()) return

    setIsSubmitting(true)
    setError(null)

    try {
      // If user needs to identify via email, do it first
      if (needsEmail) {
        const identified = await identifyWithEmail(email.trim(), name.trim() || undefined)
        if (!identified) {
          setError('Could not verify your email. Please try again.')
          setIsSubmitting(false)
          return
        }
      } else if (!isIdentified) {
        // Anonymous posting — ensure session exists
        const ok = await ensureSession()
        if (!ok) {
          setError('Could not create session. Please try again.')
          setIsSubmitting(false)
          return
        }
      }

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

  const isValid = title.trim() && (!needsEmail || email.trim())

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

        {needsEmail && (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">About you</p>
            <input
              id="widget-email"
              type="email"
              required
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
            <input
              id="widget-name"
              type="text"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
            <p className="text-[10px] text-muted-foreground/60">
              We&apos;ll notify you when there are updates.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </ScrollArea>

      <div className="px-4 py-3 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
          {(user || (needsEmail && email.trim())) && (
            <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground shrink-0">
              {(user?.name || name.trim() || email.trim() || '?').charAt(0).toUpperCase()}
            </span>
          )}
          {user
            ? user.name || user.email
            : needsEmail
              ? email.trim() || 'Your email is required'
              : 'Posting anonymously'}
        </span>
        <button
          type="submit"
          disabled={!isValid || isSubmitting}
          className="px-4 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Submitting...' : 'Submit idea'}
        </button>
      </div>
    </form>
  )
}
