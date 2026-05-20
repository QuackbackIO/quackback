import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { PortalAuthShell } from '@/components/auth/portal-auth-shell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { consumeRecoveryCodeFn } from '@/lib/server/functions/recovery-codes-consume'

/**
 * Recovery-code sign-in. Email + 12-character code in XXXX-XXXX-XXXX
 * shape. On success the consume server fn returns a magic-link verify
 * URL; we redirect the browser there to mint the actual session via
 * better-auth's standard verify endpoint.
 */
export const Route = createFileRoute('/auth/recovery')({
  component: RecoveryPage,
})

function RecoveryPage() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await consumeRecoveryCodeFn({ data: { email, code } })
      if (result.ok) {
        window.location.href = result.redirectUrl
        return
      }
      setError("Email or recovery code doesn't match. Try another code.")
    } catch {
      setError('Something went wrong. Try again in a moment.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PortalAuthShell
      heading="Use a recovery code"
      subheading="When SSO is unavailable, sign in with one of the codes you saved when SSO was set up."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code">Recovery code</Label>
          <Input
            id="code"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            placeholder="XXXX-XXXX-XXXX"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            Codes are case-insensitive and dashes are optional.
          </p>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </PortalAuthShell>
  )
}
