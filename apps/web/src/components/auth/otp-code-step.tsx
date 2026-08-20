import { useIntl, FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/shared/form-error'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { InputOTP, InputOTPSixSlots } from '@/components/ui/input-otp'

interface OtpCodeStepProps {
  /** Email already submitted — only used in the inner header when shown. */
  email: string
  code: string
  onCodeChange: (code: string) => void
  onComplete: (code: string) => void
  onSubmit: (e: React.FormEvent) => void
  onResend: () => void
  onBack: () => void
  loading: boolean
  error: string
  resendCooldown: number
  /** When true, render an inner header (full-page form). Inline-dialog
   * callers leave this off because the dialog already shows the email. */
  showInnerHeader?: boolean
  /**
   * The workspace has closed self-service signup, so an address with no
   * account here will never receive a code.
   *
   * A fact about the WORKSPACE, never about the address that was typed: the
   * note below renders for every address whenever this is true. The sign-in
   * endpoint answers identically for an address it accepts and one it refuses,
   * precisely so that nobody can read account existence out of it, and a note
   * that appeared only for refused addresses would put that oracle back in the
   * browser. What it buys instead is that somebody who will never get a code is
   * told why, rather than watching an empty inbox.
   */
  signupClosed?: boolean
}

/**
 * The code-entry surface shared between the full-page and inline
 * dialog auth forms. Auto-submits on the 6th digit; the Verify
 * button stays as a fallback for paste-recovery and a11y.
 */
export function OtpCodeStep({
  email,
  code,
  onCodeChange,
  onComplete,
  onSubmit,
  onResend,
  onBack,
  loading,
  error,
  resendCooldown,
  showInnerHeader = false,
  signupClosed = false,
}: OtpCodeStepProps) {
  const intl = useIntl()
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onBack()
        }
      }}
    >
      {showInnerHeader && (
        <div className="space-y-1.5 text-center">
          <h2 className="text-lg font-semibold">
            <FormattedMessage id="portal.auth.otp.title" defaultMessage="Check your email" />
          </h2>
          <p className="text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.auth.otp.description"
              defaultMessage="Check {email} for your 6-digit code."
              values={{
                email: <span className="font-medium text-foreground break-all">{email}</span>,
              }}
            />
          </p>
        </div>
      )}

      {error && <FormError message={error} />}

      {signupClosed && (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <FormattedMessage
            id="portal.auth.otp.signupClosedNote"
            defaultMessage="This workspace is not accepting new accounts. If this address does not already have one, no code will arrive. Ask your workspace admin to invite you."
          />
        </p>
      )}

      <div className="flex justify-center">
        <InputOTP
          maxLength={6}
          value={code}
          onChange={onCodeChange}
          onComplete={onComplete}
          disabled={loading}
          autoFocus
          autoComplete="one-time-code"
          aria-label={intl.formatMessage({
            id: 'portal.auth.otp.codeAriaLabel',
            defaultMessage: 'Verification code',
          })}
          aria-invalid={!!error || undefined}
        >
          <InputOTPSixSlots />
        </InputOTP>
      </div>

      <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
        {loading ? (
          <>
            <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
            <FormattedMessage id="portal.auth.otp.verifying" defaultMessage="Verifying…" />
          </>
        ) : (
          <FormattedMessage id="portal.auth.otp.verify" defaultMessage="Verify code" />
        )}
      </Button>

      <div className="space-y-1.5 text-center">
        <p className="text-xs text-muted-foreground">
          <FormattedMessage
            id="portal.auth.otp.linkAlsoWorks"
            defaultMessage="The sign-in link in your email also works."
          />{' '}
          <button
            type="button"
            onClick={onResend}
            disabled={resendCooldown > 0 || loading}
            className="rounded-sm text-foreground underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground/70 disabled:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {resendCooldown > 0 ? (
              <FormattedMessage
                id="portal.auth.otp.resendIn"
                defaultMessage="Resend in {seconds}s"
                values={{ seconds: resendCooldown }}
              />
            ) : (
              <FormattedMessage id="portal.auth.otp.resend" defaultMessage="Resend email" />
            )}
          </button>
        </p>
        <button
          type="button"
          onClick={onBack}
          className="rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FormattedMessage
            id="portal.auth.useDifferentEmail"
            defaultMessage="Use a different email"
          />
        </button>
      </div>
    </form>
  )
}
