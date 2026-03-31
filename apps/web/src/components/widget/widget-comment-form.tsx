import { useState, useCallback } from 'react'
import { useWidgetAuth } from './widget-auth-provider'

interface WidgetUser {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

interface WidgetCommentFormProps {
  isIdentified: boolean
  user: WidgetUser | null
  onSubmit: (content: string) => Promise<void>
  identifyWithEmail: (email: string, name?: string) => Promise<boolean>
}

export function WidgetCommentForm({
  isIdentified,
  user,
  onSubmit,
  identifyWithEmail,
}: WidgetCommentFormProps) {
  const { ensureSessionThen } = useWidgetAuth()
  const [commentText, setCommentText] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = isIdentified
    ? commentText.trim().length > 0
    : commentText.trim().length > 0 && email.trim().length > 0

  const handleSubmit = useCallback(async () => {
    const content = commentText.trim()
    if (!content || isSubmitting) return

    setIsSubmitting(true)
    setError(null)

    try {
      if (!isIdentified) {
        const trimmedEmail = email.trim()
        if (!trimmedEmail) return
        const success = await identifyWithEmail(trimmedEmail, name.trim() || undefined)
        if (!success) {
          setError('Could not verify email. Please try again.')
          return
        }
      }

      await ensureSessionThen(async () => {
        await onSubmit(content)
        setCommentText('')
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    commentText,
    isSubmitting,
    isIdentified,
    email,
    name,
    identifyWithEmail,
    ensureSessionThen,
    onSubmit,
  ])

  return (
    <div className="mb-3">
      <textarea
        value={commentText}
        onChange={(e) => setCommentText(e.target.value)}
        placeholder="Write a comment..."
        rows={2}
        disabled={isSubmitting}
        className="w-full min-h-[52px] max-h-[120px] resize-none rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-50 transition-colors"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            handleSubmit()
          }
        }}
      />

      {!isIdentified ? (
        <div className="flex items-center gap-1.5 mt-1.5">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 min-w-0 bg-background rounded-md border border-border/50 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 transition-colors"
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-28 bg-background rounded-md border border-border/50 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 transition-colors"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !canSubmit}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isSubmitting ? '...' : 'Post'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-1.5">
          <p className="text-[10px] text-muted-foreground/50 flex-1">
            Posting as {user?.name || user?.email}
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !canSubmit}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isSubmitting ? '...' : 'Post'}
          </button>
        </div>
      )}

      {error && <p className="text-[10px] text-destructive mt-1">{error}</p>}
    </div>
  )
}
