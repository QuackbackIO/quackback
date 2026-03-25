'use client'

import { useState, useRef, useEffect } from 'react'
import { useWidgetAuth } from './widget-auth-provider'

interface WidgetEmailCaptureProps {
  /** Message shown above the form */
  heading?: string
  /** Compact variant for inline use (e.g. in post detail) */
  compact?: boolean
}

export function WidgetEmailCapture({
  heading = 'Enter your email to continue',
  compact = false,
}: WidgetEmailCaptureProps) {
  const { identifyWithEmail } = useWidgetAuth()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [showName, setShowName] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!compact) {
      const timer = setTimeout(() => emailRef.current?.focus(), 100)
      return () => clearTimeout(timer)
    }
  }, [compact])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail || isSubmitting) return

    setIsSubmitting(true)
    setError(null)

    const success = await identifyWithEmail(trimmedEmail, name.trim() || undefined)

    if (!success) {
      setError('Something went wrong. Please try again.')
      setIsSubmitting(false)
    }
  }

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary'

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className="space-y-2">
        <p className="text-xs font-medium text-foreground">{heading}</p>
        <div className="flex gap-1.5">
          <input
            ref={emailRef}
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} text-xs py-1.5`}
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

  return (
    <div className="flex flex-col items-center justify-center py-6 px-4">
      <p className="text-sm font-medium text-foreground text-center">{heading}</p>
      <p className="text-xs text-muted-foreground text-center mt-1">
        No account needed — just your email.
      </p>

      <form onSubmit={handleSubmit} className="w-full mt-4 space-y-2">
        <input
          ref={emailRef}
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />

        {showName ? (
          <input
            type="text"
            placeholder="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowName(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            + Add your name
          </button>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={!email.trim() || isSubmitting}
          className="w-full px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Continuing...' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
