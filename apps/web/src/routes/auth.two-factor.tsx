import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { authClient } from '@/lib/client/auth-client'
import { clearTwoFactorCallbackUrl, resolveTwoFactorDest } from '@/lib/server/auth/client'

// Accept both casings: Better-Auth's own convention is `callbackURL`
// (matches the `signIn.email({ callbackURL })` option name), but older
// callers and our own login forms historically used `callbackUrl`. The
// resolver picks whichever is set and falls through to `/`. We also
// honour a sessionStorage stash that the twoFactorClient's redirect
// handler reads on the login → 2FA-challenge hop, since Better-Auth's
// own redirect doesn't forward the original `callbackURL` field
// (verified against `node_modules/.bun/better-auth@1.6.5/.../two-factor/client.mjs`).
const searchSchema = z.object({
  callbackURL: z.string().optional(),
  callbackUrl: z.string().optional(),
})

export const Route = createFileRoute('/auth/two-factor')({
  validateSearch: searchSchema,
  component: TwoFactorPage,
})

function TwoFactorPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function verifyCode(value: string) {
    if (pending) return
    setError(null)
    setPending(true)
    try {
      const { error: betterErr } = useBackup
        ? await authClient.twoFactor.verifyBackupCode({ code: value })
        : await authClient.twoFactor.verifyTotp({ code: value })
      if (betterErr) throw new Error(betterErr.message ?? 'Code rejected.')
      const dest = resolveTwoFactorDest(search)
      // Clear the stash on every successful challenge — the login form
      // set it expecting this exact navigation, no reason to keep it
      // around (next sign-in will set its own).
      clearTwoFactorCallbackUrl()
      void navigate({ to: dest })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code rejected.')
    } finally {
      setPending(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void verifyCode(code)
  }

  return (
    <div className="max-w-sm mx-auto mt-16 space-y-4 p-6">
      <h1 className="text-lg font-semibold">
        {useBackup ? 'Enter a backup code' : 'Two-factor code'}
      </h1>
      <p className="text-sm text-muted-foreground">
        {useBackup
          ? 'Use one of the one-time backup codes you saved during setup.'
          : 'Open your authenticator app and enter the 6-digit code.'}
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Label htmlFor="tf-input" className="sr-only">
          {useBackup ? 'Backup code' : 'Code'}
        </Label>
        {useBackup ? (
          <Input
            id="tf-input"
            inputMode="text"
            maxLength={16}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
          />
        ) : (
          <div className="flex justify-center">
            <InputOTP
              id="tf-input"
              maxLength={6}
              value={code}
              onChange={setCode}
              onComplete={(value) => void verifyCode(value)}
              disabled={pending}
              autoFocus
              autoComplete="one-time-code"
              aria-label="Authenticator code"
              aria-invalid={!!error || undefined}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={pending || !code}>
          {pending ? 'Verifying…' : 'Continue'}
        </Button>
      </form>
      <button
        type="button"
        onClick={() => {
          setUseBackup(!useBackup)
          setCode('')
          setError(null)
        }}
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
      >
        {useBackup ? 'Use authenticator code instead' : 'Use a backup code instead'}
      </button>
    </div>
  )
}
