import { useState } from 'react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { authClient } from '@/lib/client/auth-client'

interface Props {
  enrolled: boolean
  onChanged: () => void
}

export function TwoFactorSection({ enrolled, onChanged }: Props) {
  const [setupOpen, setSetupOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Two-factor authentication</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Adds a 6-digit code from an authenticator app on top of your password. Has no effect on
          SSO sign-ins.
        </p>
      </div>
      {enrolled ? (
        <Button variant="outline" size="sm" onClick={() => setDisableOpen(true)}>
          Disable two-factor
        </Button>
      ) : (
        <Button size="sm" onClick={() => setSetupOpen(true)}>
          Set up authenticator
        </Button>
      )}
      {setupOpen && (
        <SetupDialog
          onClose={() => setSetupOpen(false)}
          onComplete={() => {
            setSetupOpen(false)
            onChanged()
          }}
        />
      )}
      {disableOpen && (
        <DisableDialog
          onClose={() => setDisableOpen(false)}
          onComplete={() => {
            setDisableOpen(false)
            onChanged()
          }}
        />
      )}
    </section>
  )
}

/**
 * Shared password-confirm form used by the 2FA setup + disable dialogs.
 * Both surfaces re-prompt for the user's password before a sensitive
 * change, with the same error/pending wiring — only the submit label,
 * button variant, fallback error message, and onSubmit action differ.
 */
function PasswordConfirmForm({
  onCancel,
  onSubmit,
  pendingLabel,
  submitLabel,
  fallbackError,
  description,
  variant,
  inputId,
}: {
  onCancel: () => void
  onSubmit: (password: string) => Promise<void>
  pendingLabel: string
  submitLabel: string
  fallbackError: string
  description: string
  variant?: 'default' | 'destructive'
  inputId?: string
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await onSubmit(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackError)
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-muted-foreground">{description}</p>
      {inputId && (
        <Label htmlFor={inputId} className="sr-only">
          Password
        </Label>
      )}
      <Input
        id={inputId}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        required
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant={variant} disabled={pending || !password}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

function SetupDialog({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<'password' | 'qr' | 'backup'>('password')
  const [code, setCode] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleEnable(password: string) {
    const { data, error: betterErr } = await authClient.twoFactor.enable({
      password,
    })
    if (betterErr) throw new Error(betterErr.message ?? 'Could not start 2FA setup.')
    if (!data) throw new Error('Empty response from 2FA enable endpoint.')
    const dataUrl = await QRCode.toDataURL(data.totpURI)
    setQrDataUrl(dataUrl)
    setBackupCodes(data.backupCodes)
    setStep('qr')
  }

  async function verifyCode(value: string) {
    if (pending) return
    setError(null)
    setPending(true)
    try {
      const { error: betterErr } = await authClient.twoFactor.verifyTotp({ code: value })
      if (betterErr) throw new Error(betterErr.message ?? 'Code rejected.')
      setStep('backup')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code rejected.')
    } finally {
      setPending(false)
    }
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    void verifyCode(code)
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'password' && 'Confirm your password'}
            {step === 'qr' && 'Scan with your authenticator'}
            {step === 'backup' && 'Save your backup codes'}
          </DialogTitle>
        </DialogHeader>
        {step === 'password' && (
          <PasswordConfirmForm
            inputId="tf-password"
            description="For your security, re-enter your password to enable two-factor authentication."
            onCancel={onClose}
            onSubmit={handleEnable}
            pendingLabel="Working…"
            submitLabel="Continue"
            fallbackError="Could not start 2FA setup."
          />
        )}
        {step === 'qr' && (
          <form onSubmit={handleVerify} className="space-y-3">
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="TOTP QR code"
                className="mx-auto h-44 w-44 bg-white p-2 rounded"
              />
            )}
            <p className="text-xs text-muted-foreground text-center">
              Scan with Google Authenticator, 1Password, Authy, or any TOTP app. Then enter the
              6-digit code below.
            </p>
            <Label htmlFor="tf-code" className="sr-only">
              Code
            </Label>
            <div className="flex justify-center">
              <InputOTP
                id="tf-code"
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
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || code.length !== 6}>
                {pending ? 'Verifying…' : 'Verify'}
              </Button>
            </DialogFooter>
          </form>
        )}
        {step === 'backup' && (
          <div className="space-y-3">
            <Alert>
              <AlertDescription className="text-xs">
                Save these one-time codes somewhere safe. Each can be used once if you lose access
                to your authenticator.
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
            <DialogFooter>
              <Button onClick={onComplete}>I have saved the codes</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DisableDialog({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  async function handleDisable(password: string) {
    const { error: betterErr } = await authClient.twoFactor.disable({ password })
    if (betterErr) throw new Error(betterErr.message ?? 'Could not disable two-factor.')
    onComplete()
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disable two-factor authentication?</DialogTitle>
        </DialogHeader>
        <PasswordConfirmForm
          description="Confirm your password to disable two-factor. Your authenticator will stop working immediately."
          onCancel={onClose}
          onSubmit={handleDisable}
          pendingLabel="Disabling…"
          submitLabel="Disable"
          fallbackError="Could not disable two-factor."
          variant="destructive"
        />
      </DialogContent>
    </Dialog>
  )
}
