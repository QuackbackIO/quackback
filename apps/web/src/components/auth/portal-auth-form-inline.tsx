import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/shared/form-error'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  ArrowPathIcon,
  InformationCircleIcon,
  EnvelopeIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/solid'
import { AUTH_PROVIDER_ICON_MAP } from '@/components/icons/social-provider-icons'
import { getEnabledOAuthProviders } from '@/components/auth/oauth-buttons'
import { openAuthPopup, usePopupTracker } from '@/lib/client/hooks/use-auth-broadcast'
import { authClient } from '@/lib/server/auth/client'

interface OrgAuthConfig {
  found: boolean
  oauth: Record<string, boolean | undefined>
  openSignup?: boolean
}

interface InvitationInfo {
  id: string
  email: string
  role: string | null
  workspaceName: string
  inviterName: string | null
}

interface PortalAuthFormInlineProps {
  mode: 'login' | 'signup'
  authConfig?: OrgAuthConfig | null
  invitationId?: string | null
  /** Called to switch between login/signup modes */
  onModeSwitch?: (mode: 'login' | 'signup') => void
}

type Step = 'credentials' | 'email' | 'code' | 'forgot' | 'reset'

interface OAuthButtonProps {
  icon: React.ReactNode | null
  label: string
  mode: 'login' | 'signup'
  loading: boolean
  disabled: boolean
  onClick: () => void
}

function OAuthButton({
  icon,
  label,
  mode,
  loading,
  disabled,
  onClick,
}: OAuthButtonProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="w-full"
      disabled={disabled}
    >
      {loading ? <ArrowPathIcon className="h-5 w-5 animate-spin" /> : icon}
      {mode === 'login' ? 'Sign in' : 'Sign up'} with {label}
    </Button>
  )
}

/**
 * Inline Portal Auth Form for use in dialogs/popovers
 *
 * Supports password, email OTP, and OAuth authentication.
 *
 * Unlike the full-page PortalAuthForm, this version:
 * - Opens OAuth in popup windows instead of redirecting
 * - Signals success via BroadcastChannel to parent
 * - Better-auth automatically creates users if they don't exist
 */
export function PortalAuthFormInline({
  mode,
  authConfig,
  invitationId,
  onModeSwitch,
}: PortalAuthFormInlineProps) {
  const passwordEnabled = authConfig?.oauth?.password ?? true
  const emailOtpEnabled = authConfig?.oauth?.email !== false
  const defaultStep: Step = passwordEnabled ? 'credentials' : 'email'

  const [step, setStep] = useState<Step>(defaultStep)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [loadingInvitation, setLoadingInvitation] = useState(!!invitationId)
  const [popupBlocked, setPopupBlocked] = useState(false)

  const codeInputRef = useRef<HTMLInputElement>(null)

  // Track popup windows
  const { trackPopup, clearPopup, hasPopup, focusPopup } = usePopupTracker({
    onPopupClosed: () => {
      setLoadingAction(null)
      setPopupBlocked(false)
    },
  })

  // Fetch invitation details if invitationId is provided
  useEffect(() => {
    if (!invitationId) {
      setLoadingInvitation(false)
      return
    }

    async function fetchInvitation() {
      try {
        const response = await fetch(`/api/auth/invitation/${invitationId}`)
        if (response.ok) {
          const data = (await response.json()) as InvitationInfo
          setInvitation(data)
          setEmail(data.email)
        } else {
          const data = (await response.json()) as { error?: string }
          setError(data.error || 'Invalid or expired invitation')
        }
      } catch {
        setError('Failed to load invitation')
      } finally {
        setLoadingInvitation(false)
      }
    }

    fetchInvitation()
  }, [invitationId])

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [resendCooldown])

  // Focus code input when entering code/reset steps
  useEffect(() => {
    if ((step === 'code' || step === 'reset') && codeInputRef.current) {
      codeInputRef.current.focus()
    }
  }, [step])

  // Clear popup tracking on unmount
  useEffect(() => {
    return () => {
      clearPopup()
    }
  }, [clearPopup])

  // --- Password auth handlers ---
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError('Email is required')
      return
    }
    if (!password) {
      setError('Password is required')
      return
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoadingAction('password')
    try {
      if (mode === 'signup') {
        const result = await authClient.signUp.email({
          name: name.trim() || email.split('@')[0],
          email,
          password,
        })
        if (result.error) {
          throw new Error(result.error.message || 'Failed to create account')
        }
      } else {
        const result = await authClient.signIn.email({
          email,
          password,
        })
        if (result.error) {
          throw new Error(result.error.message || 'Invalid email or password')
        }
      }
      const { postAuthSuccess } = await import('@/lib/client/hooks/use-auth-broadcast')
      postAuthSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
      setLoadingAction(null)
    }
  }

  // --- Email OTP handlers ---
  const sendCode = async () => {
    setError('')
    setLoadingAction('email')

    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in',
      })

      if (result.error) {
        throw new Error(result.error.message || 'Failed to send code')
      }

      setStep('code')
      setResendCooldown(60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setLoadingAction(null)
    }
  }

  const verifyCode = async () => {
    setError('')
    setLoadingAction('code')

    try {
      const result = await authClient.signIn.emailOtp({
        email,
        otp: code,
      })

      if (result.error) {
        throw new Error(result.error.message || 'Failed to verify code')
      }

      const { postAuthSuccess } = await import('@/lib/client/hooks/use-auth-broadcast')
      postAuthSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify code')
      setLoadingAction(null)
    }
  }

  // --- Forgot/reset password handlers ---
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError('Email is required')
      return
    }

    setLoadingAction('forgot')
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'forget-password',
      })
      if (result.error) {
        throw new Error(result.error.message || 'Failed to send reset code')
      }
      setStep('reset')
      setResendCooldown(60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset code')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!code.trim() || code.length !== 6) {
      setError('Please enter the 6-digit code')
      return
    }
    if (!newPassword || newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }

    setLoadingAction('reset')
    try {
      const result = await authClient.emailOtp.resetPassword({
        email,
        otp: code,
        password: newPassword,
      })
      if (result.error) {
        throw new Error(result.error.message || 'Failed to reset password')
      }
      const { postAuthSuccess } = await import('@/lib/client/hooks/use-auth-broadcast')
      postAuthSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password')
      setLoadingAction(null)
    }
  }

  // --- Form submit handlers ---
  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      setError('Email is required')
      return
    }
    sendCode()
  }

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim() || code.length !== 6) {
      setError('Please enter the 6-digit code')
      return
    }
    verifyCode()
  }

  const handleResend = () => {
    if (resendCooldown > 0) return
    setCode('')
    sendCode()
  }

  const handleResendForgot = () => {
    if (resendCooldown > 0) return
    setCode('')
    setNewPassword('')
    setLoadingAction('forgot')
    authClient.emailOtp
      .sendVerificationOtp({ email, type: 'forget-password' })
      .then((result) => {
        if (result.error) setError(result.error.message || 'Failed to resend code')
        else setResendCooldown(60)
      })
      .catch(() => setError('Failed to resend code'))
      .finally(() => setLoadingAction(null))
  }

  const handleBack = () => {
    setError('')
    setCode('')
    setNewPassword('')
    setStep(defaultStep)
  }

  /**
   * Initiate OAuth login using Better Auth's socialProviders.
   */
  const initiateOAuth = async (provider: string) => {
    setError('')

    if (hasPopup()) {
      focusPopup()
      return
    }

    setLoadingAction(provider)
    setPopupBlocked(false)

    const popup = openAuthPopup('about:blank')
    if (!popup) {
      setPopupBlocked(true)
      setLoadingAction(null)
      return
    }
    trackPopup(popup)

    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: '/auth/auth-complete',
        disableRedirect: true,
      })

      if (result.data?.url) {
        popup.location.href = result.data.url
      } else {
        popup.close()
        setError(result.error?.message || 'Failed to initiate sign in')
        setLoadingAction(null)
      }
    } catch (err) {
      popup.close()
      setError(err instanceof Error ? err.message : 'Failed to initiate sign in')
      setLoadingAction(null)
    }
  }

  // Derive which auth methods are enabled
  const enabledProviders = getEnabledOAuthProviders(authConfig?.oauth ?? {})
  const showOAuth = enabledProviders.length > 0

  // Loading invitation
  if (loadingInvitation) {
    return (
      <div className="flex items-center justify-center py-8">
        <ArrowPathIcon className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // If we tried to load an invitation but it failed, show the error
  if (invitationId && !invitation && error) {
    return (
      <Alert variant="destructive">
        <InformationCircleIcon className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  // Popup blocked warning
  if (popupBlocked) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <InformationCircleIcon className="h-4 w-4" />
          <AlertDescription>
            Popup was blocked by your browser. Please allow popups for this site and try again.
          </AlertDescription>
        </Alert>
        <Button onClick={() => setPopupBlocked(false)} variant="outline" className="w-full">
          Try again
        </Button>
      </div>
    )
  }

  const showOAuthOnDefault =
    showOAuth && (step === 'credentials' || step === 'email') && !invitation
  const hasCredentialForm = step === 'credentials' && passwordEnabled
  const hasEmailForm = step === 'email' && emailOtpEnabled

  return (
    <div className="space-y-6">
      {/* Invitation Banner */}
      {invitation && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <EnvelopeIcon className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-foreground">You&apos;ve been invited!</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create your account to join{' '}
                <span className="font-medium text-foreground">{invitation.workspaceName}</span>
                {invitation.inviterName && <> (invited by {invitation.inviterName})</>}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* OAuth Buttons - only show on default step for non-invitation flow */}
      {showOAuthOnDefault && (
        <>
          <div className="space-y-3">
            {enabledProviders.map((provider) => {
              const IconComp = AUTH_PROVIDER_ICON_MAP[provider.id]
              return (
                <OAuthButton
                  key={provider.id}
                  icon={IconComp ? <IconComp className="h-5 w-5" /> : null}
                  label={provider.name}
                  mode={mode}
                  loading={loadingAction === provider.id}
                  disabled={loadingAction !== null}
                  onClick={() => initiateOAuth(provider.id)}
                />
              )
            })}
          </div>
          {/* Divider - only show when another method is also enabled */}
          {(passwordEnabled || emailOtpEnabled) && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-background px-2 text-muted-foreground">
                  Or continue with {passwordEnabled ? 'email' : 'email code'}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Password credentials form */}
      {hasCredentialForm && (
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {error && <FormError message={error} />}

          {mode === 'signup' && (
            <div className="space-y-2">
              <label htmlFor="inline-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="inline-name"
                type="text"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loadingAction !== null}
                autoComplete="name"
              />
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="inline-email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="inline-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!!invitation || loadingAction !== null}
              className={invitation ? 'bg-muted' : ''}
              autoComplete="email"
            />
            {invitation && (
              <p className="text-xs text-muted-foreground">Email is set from your invitation</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="inline-password" className="text-sm font-medium">
              Password
            </label>
            <Input
              id="inline-password"
              type="password"
              placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loadingAction !== null}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          {mode === 'login' && (
            <div className="text-right">
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setStep('forgot')
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Forgot password?
              </button>
            </div>
          )}

          <Button type="submit" disabled={loadingAction !== null} className="w-full">
            {loadingAction === 'password' && (
              <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
            )}
            {loadingAction === 'password'
              ? mode === 'signup'
                ? 'Creating account...'
                : 'Signing in...'
              : mode === 'signup'
                ? 'Create account'
                : 'Sign in'}
          </Button>

          {/* Link to email OTP if also enabled */}
          {emailOtpEnabled && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setStep('email')
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Use email code instead
              </button>
            </div>
          )}

          {/* Mode switch */}
          {onModeSwitch && (
            <p className="text-center text-sm text-muted-foreground">
              {mode === 'login' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    onClick={() => onModeSwitch('signup')}
                    className="text-primary hover:underline font-medium"
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => onModeSwitch('login')}
                    className="text-primary hover:underline font-medium"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          )}
        </form>
      )}

      {/* Email OTP: email input step */}
      {hasEmailForm && (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          {error && <FormError message={error} />}

          <div className="space-y-2">
            <label htmlFor="inline-otp-email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="inline-otp-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!!invitation || loadingAction !== null}
              className={invitation ? 'bg-muted' : ''}
              autoComplete="email"
            />
            {invitation && (
              <p className="text-xs text-muted-foreground">Email is set from your invitation</p>
            )}
          </div>

          <Button type="submit" disabled={loadingAction !== null} className="w-full">
            {loadingAction === 'email' ? (
              <>
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                Sending code...
              </>
            ) : (
              'Continue with email'
            )}
          </Button>

          {/* Link back to password if also enabled */}
          {passwordEnabled && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setStep('credentials')
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Use password instead
              </button>
            </div>
          )}

          {/* Mode switch */}
          {onModeSwitch && (
            <p className="text-center text-sm text-muted-foreground">
              {mode === 'login' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    onClick={() => onModeSwitch('signup')}
                    className="text-primary hover:underline font-medium"
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => onModeSwitch('login')}
                    className="text-primary hover:underline font-medium"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          )}
        </form>
      )}

      {/* Email OTP: code verification step */}
      {step === 'code' && (
        <form onSubmit={handleCodeSubmit} className="space-y-4">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="mr-1 h-4 w-4" />
            Back
          </button>

          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-sm text-center">
              We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
            </p>
          </div>

          {error && <FormError message={error} />}

          <div className="space-y-2">
            <label htmlFor="inline-code" className="text-sm font-medium">
              Verification code
            </label>
            <Input
              ref={codeInputRef}
              id="inline-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={loadingAction !== null}
              className="text-center text-2xl tracking-widest"
              autoComplete="one-time-code"
            />
          </div>

          <Button
            type="submit"
            disabled={loadingAction !== null || code.length !== 6}
            className="w-full"
          >
            {loadingAction === 'code' ? (
              <>
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              'Verify code'
            )}
          </Button>

          <div className="text-center">
            <button
              type="button"
              onClick={handleResend}
              disabled={resendCooldown > 0 || loadingAction !== null}
              className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : "Didn't receive a code? Resend"}
            </button>
          </div>
        </form>
      )}

      {/* Forgot password: enter email */}
      {step === 'forgot' && (
        <form onSubmit={handleForgotSubmit} className="space-y-4">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="mr-1 h-4 w-4" />
            Back
          </button>

          <div className="text-center">
            <h2 className="text-lg font-semibold">Reset your password</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your email and we&apos;ll send you a code to reset your password.
            </p>
          </div>

          {error && <FormError message={error} />}

          <div className="space-y-2">
            <label htmlFor="inline-forgot-email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="inline-forgot-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loadingAction !== null}
              autoComplete="email"
            />
          </div>

          <Button
            type="submit"
            disabled={loadingAction !== null || !email.trim()}
            className="w-full"
          >
            {loadingAction === 'forgot' ? (
              <>
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                Sending code...
              </>
            ) : (
              'Send reset code'
            )}
          </Button>
        </form>
      )}

      {/* Reset password: enter code + new password */}
      {step === 'reset' && (
        <form onSubmit={handleResetSubmit} className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setError('')
              setCode('')
              setNewPassword('')
              setStep('forgot')
            }}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="mr-1 h-4 w-4" />
            Back
          </button>

          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-sm text-center">
              We sent a reset code to <span className="font-medium text-foreground">{email}</span>
            </p>
          </div>

          {error && <FormError message={error} />}

          <div className="space-y-2">
            <label htmlFor="inline-reset-code" className="text-sm font-medium">
              Reset code
            </label>
            <Input
              ref={codeInputRef}
              id="inline-reset-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={loadingAction !== null}
              className="text-center text-2xl tracking-widest"
              autoComplete="one-time-code"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="inline-new-password" className="text-sm font-medium">
              New password
            </label>
            <Input
              id="inline-new-password"
              type="password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={loadingAction !== null}
              autoComplete="new-password"
            />
          </div>

          <Button
            type="submit"
            disabled={loadingAction !== null || code.length !== 6 || newPassword.length < 8}
            className="w-full"
          >
            {loadingAction === 'reset' ? (
              <>
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                Resetting password...
              </>
            ) : (
              'Reset password'
            )}
          </Button>

          <div className="text-center">
            <button
              type="button"
              onClick={handleResendForgot}
              disabled={resendCooldown > 0 || loadingAction !== null}
              className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : "Didn't receive a code? Resend"}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
