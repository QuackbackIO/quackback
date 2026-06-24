import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { authClient } from '@/lib/client/auth-client'

/** Inline TOTP / backup-code challenge for an already-enrolled user, shown
 *  after better-auth returns `twoFactorRedirect` from signIn.email. */
export function TwoFactorChallengeStep({
  onComplete,
  onCancel,
}: {
  onComplete: () => void
  onCancel: () => void
}): React.ReactElement {
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
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code rejected.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {useBackup
          ? 'Use one of the one-time backup codes you saved during setup.'
          : 'Open your authenticator app and enter the 6-digit code.'}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void verifyCode(code)
        }}
        className="space-y-3"
      >
        <Label htmlFor="tf-challenge" className="sr-only">
          {useBackup ? 'Backup code' : 'Authenticator code'}
        </Label>
        {useBackup ? (
          <Input
            id="tf-challenge"
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
              id="tf-challenge"
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
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !code}>
            {pending ? 'Verifying…' : 'Continue'}
          </Button>
        </div>
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
