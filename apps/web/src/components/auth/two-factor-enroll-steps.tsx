import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { InputOTP, InputOTPSixSlots } from '@/components/ui/input-otp'
import { authClient } from '@/lib/client/auth-client'

/**
 * Authenticator enrollment steps (QR → verify → backup codes), shared by the
 * settings page and the inline auth dialog. The caller supplies the already-
 * confirmed password (settings re-prompts; the auth dialog reuses the sign-in
 * password) and is notified on completion / cancellation.
 */
export function TwoFactorEnrollSteps({
  password,
  onComplete,
  onCancel,
  onStepChange,
}: {
  password: string
  onComplete: () => void
  onCancel: () => void
  onStepChange?: (step: 'qr' | 'backup') => void
}): React.ReactElement {
  const [step, setStep] = useState<'loading' | 'qr' | 'backup'>('loading')
  const [code, setCode] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function start() {
      const { data, error: betterErr } = await authClient.twoFactor.enable({ password })
      if (cancelled) return
      if (betterErr || !data) {
        setError(betterErr?.message ?? 'Could not start 2FA setup.')
        return
      }
      // Re-check after the second await — without this, a QR render that
      // resolves after unmount sets state on a dead component, and React's
      // scheduler then touches a torn-down `window` (surfaces as an unhandled
      // "window is not defined" that fails the test run).
      const qrDataUrl = await QRCode.toDataURL(data.totpURI)
      if (cancelled) return
      setQrDataUrl(qrDataUrl)
      setBackupCodes(data.backupCodes)
      setStep('qr')
      onStepChange?.('qr')
    }
    void start()
    return () => {
      cancelled = true
    }
  }, [password, onStepChange])

  async function verifyCode(value: string) {
    if (pending) return
    setError(null)
    setPending(true)
    try {
      const { error: betterErr } = await authClient.twoFactor.verifyTotp({ code: value })
      if (betterErr) throw new Error(betterErr.message ?? 'Code rejected.')
      setStep('backup')
      onStepChange?.('backup')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code rejected.')
    } finally {
      setPending(false)
    }
  }

  if (step === 'loading') {
    return (
      <div className="space-y-3">
        {error ? (
          <>
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Starting setup…</p>
        )}
      </div>
    )
  }

  if (step === 'backup') {
    return (
      <div className="space-y-3">
        <Alert>
          <AlertDescription className="text-xs">
            Save these one-time codes somewhere safe. Each can be used once if you lose access to
            your authenticator.
          </AlertDescription>
        </Alert>
        <pre className="rounded-md border border-border/50 bg-muted/30 p-3 text-xs font-mono columns-2">
          {backupCodes.join('\n')}
        </pre>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigator.clipboard.writeText(backupCodes.join('\n'))}
        >
          Copy all codes
        </Button>
        <Button className="w-full" onClick={onComplete}>
          I have saved the codes
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void verifyCode(code)
      }}
      className="space-y-3"
    >
      {qrDataUrl && (
        <img
          src={qrDataUrl}
          alt="TOTP QR code"
          className="mx-auto h-44 w-44 bg-white p-2 rounded"
        />
      )}
      <p className="text-xs text-muted-foreground text-center">
        Scan with Google Authenticator, 1Password, Authy, or any TOTP app, then enter the 6-digit
        code.
      </p>
      <div className="flex justify-center">
        <InputOTP
          id="tf-enroll-code"
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
          <InputOTPSixSlots />
        </InputOTP>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || code.length !== 6}>
          {pending ? 'Verifying…' : 'Verify'}
        </Button>
      </div>
    </form>
  )
}
