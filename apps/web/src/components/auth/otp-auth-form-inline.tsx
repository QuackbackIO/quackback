import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, InfoIcon, Mail, ArrowLeft, Github } from 'lucide-react'
import { openAuthPopup, usePopupTracker } from '@/lib/hooks/use-auth-broadcast'
import { authClient } from '@/lib/auth/client'

interface OrgAuthConfig {
  found: boolean
  oauth: {
    google: boolean
    github: boolean
    microsoft?: boolean
  }
  openSignup?: boolean
}

interface InvitationInfo {
  id: string
  email: string
  role: string | null
  workspaceName: string
  inviterName: string | null
}

interface OTPAuthFormInlineProps {
  mode: 'login' | 'signup'
  authConfig?: OrgAuthConfig | null
  invitationId?: string | null
  /** Organization slug for OAuth */
  orgSlug: string
  /** Called when auth completes (popup broadcasts success) - handled by parent via BroadcastChannel */
  _onSuccess?: () => void
  /** Called to switch between login/signup modes */
  onModeSwitch?: (mode: 'login' | 'signup') => void
}

type Step = 'email' | 'code'

/**
 * Inline OTP Auth Form for use in dialogs/popovers
 *
 * Uses Better-auth's emailOTP plugin for passwordless authentication.
 *
 * Unlike the full-page OTPAuthForm, this version:
 * - Opens OAuth in popup windows instead of redirecting
 * - Signals success via BroadcastChannel to parent
 * - Better-auth automatically creates users if they don't exist
 */
export function OTPAuthFormInline({
  mode,
  authConfig,
  invitationId,
  orgSlug,
  onModeSwitch,
}: OTPAuthFormInlineProps) {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  // Track which specific action is loading (null = not loading)
  const [loadingAction, setLoadingAction] = useState<
    'email' | 'code' | 'google' | 'github' | 'microsoft' | null
  >(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [loadingInvitation, setLoadingInvitation] = useState(!!invitationId)
  const [popupBlocked, setPopupBlocked] = useState(false)

  const codeInputRef = useRef<HTMLInputElement>(null)

  // Track popup windows
  const { trackPopup, clearPopup, hasPopup, focusPopup } = usePopupTracker({
    onPopupClosed: () => {
      // User closed popup without completing auth
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
          const data = await response.json()
          setInvitation(data)
          setEmail(data.email)
        } else {
          const data = await response.json()
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

  // Focus code input when step changes
  useEffect(() => {
    if (step === 'code' && codeInputRef.current) {
      codeInputRef.current.focus()
    }
  }, [step])

  // Clear popup tracking on success (called externally via BroadcastChannel)
  useEffect(() => {
    return () => {
      clearPopup()
    }
  }, [clearPopup])

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

      // Success - session is now established
      // Broadcast success to other components (dialog will close, page will refresh)
      const { postAuthSuccess } = await import('@/lib/hooks/use-auth-broadcast')
      postAuthSuccess()
      // Loading will be cleared when parent handles the broadcast
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify code')
      setLoadingAction(null)
    }
  }

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

  const handleBack = () => {
    setError('')
    setStep('email')
    setCode('')
  }

  /**
   * Open OAuth in popup window
   */
  const initiateOAuthPopup = (provider: 'google' | 'github' | 'microsoft') => {
    if (hasPopup()) {
      focusPopup()
      return
    }

    const returnDomain = window.location.host
    const params = new URLSearchParams({
      workspace: orgSlug,
      returnDomain,
      context: 'portal',
      callbackUrl: '/',
      popup: 'true',
    })

    // Use relative URL - OAuth route is on same origin
    const oauthUrl = `/api/auth/oauth/${provider}?${params}`

    setError('')
    setLoadingAction(provider)
    setPopupBlocked(false)

    const popup = openAuthPopup(oauthUrl)
    if (!popup) {
      setPopupBlocked(true)
      setLoadingAction(null)
      return
    }

    trackPopup(popup)
  }

  // Determine which OAuth methods to show
  const showGoogle = authConfig?.oauth?.google ?? true
  const showGithub = authConfig?.oauth?.github ?? true
  const showMicrosoft = authConfig?.oauth?.microsoft ?? false
  const showOAuth = showGoogle || showGithub || showMicrosoft

  // Loading invitation
  if (loadingInvitation) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // If we tried to load an invitation but it failed, show the error
  if (invitationId && !invitation && error) {
    return (
      <Alert variant="destructive">
        <InfoIcon className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  // Popup blocked warning
  if (popupBlocked) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <InfoIcon className="h-4 w-4" />
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

  return (
    <div className="space-y-6">
      {/* Invitation Banner */}
      {invitation && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-primary mt-0.5" />
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

      {/* OAuth Buttons - only show on initial email step for non-invitation flow */}
      {showOAuth && step === 'email' && !invitation && (
        <>
          <div className="space-y-3">
            {showGoogle && (
              <Button
                type="button"
                variant="outline"
                onClick={() => initiateOAuthPopup('google')}
                className="w-full"
                disabled={loadingAction !== null}
              >
                {loadingAction === 'google' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                )}
                {mode === 'login' ? 'Sign in' : 'Sign up'} with Google
              </Button>
            )}
            {showMicrosoft && (
              <Button
                type="button"
                variant="outline"
                onClick={() => initiateOAuthPopup('microsoft')}
                className="w-full"
                disabled={loadingAction !== null}
              >
                {loadingAction === 'microsoft' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path fill="#f25022" d="M1 1h10v10H1z" />
                    <path fill="#00a4ef" d="M1 13h10v10H1z" />
                    <path fill="#7fba00" d="M13 1h10v10H13z" />
                    <path fill="#ffb900" d="M13 13h10v10H13z" />
                  </svg>
                )}
                {mode === 'login' ? 'Sign in' : 'Sign up'} with Microsoft
              </Button>
            )}
            {showGithub && (
              <Button
                type="button"
                variant="outline"
                onClick={() => initiateOAuthPopup('github')}
                className="w-full"
                disabled={loadingAction !== null}
              >
                {loadingAction === 'github' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Github className="h-5 w-5" />
                )}
                {mode === 'login' ? 'Sign in' : 'Sign up'} with GitHub
              </Button>
            )}
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with email
              </span>
            </div>
          </div>
        </>
      )}

      {/* Step 1: Email Input */}
      {step === 'email' && (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending code...
              </>
            ) : (
              'Continue with email'
            )}
          </Button>

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

      {/* Step 2: Code Input */}
      {step === 'code' && (
        <form onSubmit={handleCodeSubmit} className="space-y-4">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </button>

          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-sm text-center">
              We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-2">
            <label htmlFor="code" className="text-sm font-medium">
              Verification code
            </label>
            <Input
              ref={codeInputRef}
              id="code"
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
    </div>
  )
}
