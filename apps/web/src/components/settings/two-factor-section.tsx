import { useState } from 'react'
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
import { authClient } from '@/lib/client/auth-client'
import { TwoFactorEnrollSteps } from '@/components/auth/two-factor-enroll-steps'

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
  const [step, setStep] = useState<'password' | 'enroll'>('password')
  const [enrollStep, setEnrollStep] = useState<'qr' | 'backup'>('qr')
  const [password, setPassword] = useState('')

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'password' && 'Confirm your password'}
            {step === 'enroll' && enrollStep === 'qr' && 'Scan with your authenticator'}
            {step === 'enroll' && enrollStep === 'backup' && 'Save your backup codes'}
          </DialogTitle>
        </DialogHeader>
        {step === 'password' && (
          <PasswordConfirmForm
            inputId="tf-password"
            description="For your security, re-enter your password to enable two-factor authentication."
            onCancel={onClose}
            onSubmit={async (pw) => {
              setPassword(pw)
              setStep('enroll')
            }}
            pendingLabel="Working…"
            submitLabel="Continue"
            fallbackError="Could not start 2FA setup."
          />
        )}
        {step === 'enroll' && (
          <TwoFactorEnrollSteps
            password={password}
            onComplete={onComplete}
            onCancel={onClose}
            onStepChange={setEnrollStep}
          />
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
