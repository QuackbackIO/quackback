import { useState } from 'react'
import { useWidgetAuth } from './widget-auth-provider'

interface WidgetEmailCaptureProps {
  heading?: string
}

export function WidgetEmailCapture({
  heading = 'Enter your email to continue',
}: WidgetEmailCaptureProps) {
  const { identifyWithEmail } = useWidgetAuth()
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail || isSubmitting) return

    setIsSubmitting(true)
    setError(null)

    const success = await identifyWithEmail(trimmedEmail)
    if (!success) {
      setError('Something went wrong. Please try again.')
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <p className="text-xs font-medium text-foreground">{heading}</p>
      <div className="flex gap-1.5">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 min-w-0 bg-background rounded-md border border-border/50 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 transition-colors"
        />
        <button
          type="submit"
          disabled={!email.trim() || isSubmitting}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {isSubmitting ? '...' : 'Go'}
        </button>
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </form>
  )
}
