import { useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
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
        <h3 className="text-sm font-semibold">
          <FormattedMessage
            id="portal.settings.twoFactor.title"
            defaultMessage="Two-factor authentication"
          />
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          <FormattedMessage
            id="portal.settings.twoFactor.description"
            defaultMessage="Adds a 6-digit code from an authenticator app on top of your password. Has no effect on SSO sign-ins."
          />
        </p>
      </div>
      {enrolled ? (
        <Button variant="outline" size="sm" onClick={() => setDisableOpen(true)}>
          <FormattedMessage
            id="portal.settings.twoFactor.disable"
            defaultMessage="Disable two-factor"
          />
        </Button>
      ) : (
        <Button size="sm" onClick={() => setSetupOpen(true)}>
          <FormattedMessage
            id="portal.settings.twoFactor.setUp"
            defaultMessage="Set up authenticator"
          />
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
          <FormattedMessage id="portal.settings.twoFactor.password" defaultMessage="Password" />
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
          <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
        </Button>
        <Button type="submit" variant={variant} disabled={pending || !password}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

function SetupDialog({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const intl = useIntl()
  const [step, setStep] = useState<'password' | 'enroll'>('password')
  const [enrollStep, setEnrollStep] = useState<'qr' | 'backup'>('qr')
  const [password, setPassword] = useState('')

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'password' && (
              <FormattedMessage
                id="portal.settings.twoFactor.setup.confirmPassword"
                defaultMessage="Confirm your password"
              />
            )}
            {step === 'enroll' && enrollStep === 'qr' && (
              <FormattedMessage
                id="portal.settings.twoFactor.setup.scan"
                defaultMessage="Scan with your authenticator"
              />
            )}
            {step === 'enroll' && enrollStep === 'backup' && (
              <FormattedMessage
                id="portal.settings.twoFactor.setup.saveCodes"
                defaultMessage="Save your backup codes"
              />
            )}
          </DialogTitle>
        </DialogHeader>
        {step === 'password' && (
          <PasswordConfirmForm
            inputId="tf-password"
            description={intl.formatMessage({
              id: 'portal.settings.twoFactor.setup.description',
              defaultMessage:
                'For your security, re-enter your password to enable two-factor authentication.',
            })}
            onCancel={onClose}
            onSubmit={async (pw) => {
              setPassword(pw)
              setStep('enroll')
            }}
            pendingLabel={intl.formatMessage({
              id: 'portal.settings.twoFactor.setup.working',
              defaultMessage: 'Working…',
            })}
            submitLabel={intl.formatMessage({
              id: 'portal.auth.continue',
              defaultMessage: 'Continue',
            })}
            fallbackError={intl.formatMessage({
              id: 'portal.settings.twoFactor.setup.failed',
              defaultMessage: 'Could not start 2FA setup.',
            })}
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
  const intl = useIntl()
  const disableFailed = intl.formatMessage({
    id: 'portal.settings.twoFactor.disableDialog.failed',
    defaultMessage: 'Could not disable two-factor.',
  })

  async function handleDisable(password: string) {
    const { error: betterErr } = await authClient.twoFactor.disable({ password })
    if (betterErr) throw new Error(betterErr.message ?? disableFailed)
    onComplete()
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <FormattedMessage
              id="portal.settings.twoFactor.disableDialog.title"
              defaultMessage="Disable two-factor authentication?"
            />
          </DialogTitle>
        </DialogHeader>
        <PasswordConfirmForm
          description={intl.formatMessage({
            id: 'portal.settings.twoFactor.disableDialog.description',
            defaultMessage:
              'Confirm your password to disable two-factor. Your authenticator will stop working immediately.',
          })}
          onCancel={onClose}
          onSubmit={handleDisable}
          pendingLabel={intl.formatMessage({
            id: 'portal.settings.twoFactor.disableDialog.disabling',
            defaultMessage: 'Disabling…',
          })}
          submitLabel={intl.formatMessage({
            id: 'portal.settings.twoFactor.disableDialog.confirm',
            defaultMessage: 'Disable',
          })}
          fallbackError={disableFailed}
          variant="destructive"
        />
      </DialogContent>
    </Dialog>
  )
}
