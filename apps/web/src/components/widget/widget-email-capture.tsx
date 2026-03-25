'use client'

import { useState, useRef, useEffect } from 'react'
import { EnvelopeIcon } from '@heroicons/react/24/outline'
import { useWidgetAuth } from './widget-auth-provider'

interface WidgetEmailCaptureProps {
  /** Message shown above the form */
  heading?: string
}

export function WidgetEmailCapture({
  heading = 'Enter your email to continue',
}: WidgetEmailCaptureProps) {
  const { identifyWithEmail } = useWidgetAuth()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => emailRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [])

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
    // On success, this component unmounts (isIdentified flips), so skip setIsSubmitting
  }

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary'

  return (
    <div className="flex flex-col items-center justify-center py-8 px-4">
      <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 mb-3">
        <EnvelopeIcon className="w-4.5 h-4.5 text-primary" />
      </div>
      <p className="text-sm font-medium text-foreground text-center">{heading}</p>

      <form onSubmit={handleSubmit} className="w-full mt-4 space-y-2.5">
        <input
          ref={emailRef}
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Your name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />

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
