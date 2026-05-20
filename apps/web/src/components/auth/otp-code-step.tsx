import { Button } from '@/components/ui/button'
import { FormError } from '@/components/shared/form-error'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'

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
}: OtpCodeStepProps) {
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
          <h2 className="text-lg font-semibold">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            We sent a 6-digit code to{' '}
            <span className="font-medium text-foreground break-all">{email}</span>.
          </p>
        </div>
      )}

      {error && <FormError message={error} />}

      <div className="flex justify-center">
        <InputOTP
          maxLength={6}
          value={code}
          onChange={onCodeChange}
          onComplete={onComplete}
          disabled={loading}
          autoFocus
          autoComplete="one-time-code"
          aria-label="Verification code"
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

      <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
        {loading ? (
          <>
            <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
            Verifying…
          </>
        ) : (
          'Verify code'
        )}
      </Button>

      <div className="space-y-1.5 text-center">
        <p className="text-xs text-muted-foreground">
          The sign-in link in your email also works.{' '}
          <button
            type="button"
            onClick={onResend}
            disabled={resendCooldown > 0 || loading}
            className="rounded-sm text-foreground underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground/70 disabled:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend email'}
          </button>
        </p>
        <button
          type="button"
          onClick={onBack}
          className="rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Use a different email
        </button>
      </div>
    </form>
  )
}
