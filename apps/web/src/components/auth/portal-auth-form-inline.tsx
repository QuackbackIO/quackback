import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  ArrowPathIcon,
  InformationCircleIcon,
  EnvelopeIcon,
  ArrowLeftIcon,
  KeyIcon,
} from '@heroicons/react/24/solid'
import { GitHubIcon, GoogleIcon } from '@/components/icons/social-icons'
import { openAuthPopup, usePopupTracker } from '@/lib/hooks/use-auth-broadcast'
import { authClient } from '@/lib/auth/client'
import type { PublicOIDCConfig } from '@/lib/settings'

type OAuthProvider = 'google' | 'github' | 'oidc'

interface OrgAuthConfig {
  found: boolean
  oauth: {
    google: boolean
    github: boolean
  }
  oidc?: PublicOIDCConfig | null
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
  /** Organization slug for OAuth */
  orgSlug: string
  /** Called to switch between login/signup modes */
  onModeSwitch?: (mode: 'login' | 'signup') => void
}

type Step = 'email' | 'code'

interface OAuthButtonProps {
  provider: string
  icon: React.ReactNode
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
 * Supports email OTP, OAuth, and OIDC authentication.
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
  orgSlug,
  onModeSwitch,
}: PortalAuthFormInlineProps) {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  // Track which specific action is loading (null = not loading)
  const [loadingAction, setLoadingAction] = useState<
    'email' | 'code' | 'google' | 'github' | 'oidc' | null
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
   * Initiate OAuth login
   *
   * All providers use popup windows for authentication.
   * All providers use the custom /api/auth/oauth/[provider] route which:
   * - Handles OAuth initiation with signed state containing workspace info
   * - Redirects callback to app domain, then transfers session to tenant domain
   */
  const initiateOAuth = (provider: OAuthProvider) => {
    setError('')

    // If popup already open, just focus it
    if (hasPopup()) {
      focusPopup()
      return
    }

    setLoadingAction(provider)
    setPopupBlocked(false)

    // Build OAuth initiation URL with workspace info
    const returnDomain = window.location.host
    const params = new URLSearchParams({
      workspace: orgSlug,
      returnDomain,
      callbackUrl: '/auth/auth-complete',
      popup: 'true',
      ...(provider === 'oidc' ? { type: 'portal' } : {}),
    })

    const oauthUrl = `/api/auth/oauth/${provider}?${params}`
    const popup = openAuthPopup(oauthUrl)
    if (!popup) {
      setPopupBlocked(true)
      setLoadingAction(null)
      return
    }
    trackPopup(popup)
  }

  // Determine which OAuth methods to show
  const showGoogle = authConfig?.oauth?.google ?? false
  const showGithub = authConfig?.oauth?.github ?? false
  const showOidc = authConfig?.oidc?.enabled === true
  const oidcDisplayName = authConfig?.oidc?.displayName || 'SSO'
  const showOAuth = showGoogle || showGithub || showOidc

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

      {/* OAuth Buttons - only show on initial email step for non-invitation flow */}
      {showOAuth && step === 'email' && !invitation && (
        <>
          <div className="space-y-3">
            {showOidc && (
              <OAuthButton
                provider="oidc"
                icon={<KeyIcon className="h-5 w-5" />}
                label={oidcDisplayName}
                mode={mode}
                loading={loadingAction === 'oidc'}
                disabled={loadingAction !== null}
                onClick={() => initiateOAuth('oidc')}
              />
            )}
            {showGoogle && (
              <OAuthButton
                provider="google"
                icon={<GoogleIcon className="h-5 w-5" />}
                label="Google"
                mode={mode}
                loading={loadingAction === 'google'}
                disabled={loadingAction !== null}
                onClick={() => initiateOAuth('google')}
              />
            )}
            {showGithub && (
              <OAuthButton
                provider="github"
                icon={<GitHubIcon className="h-5 w-5" />}
                label="GitHub"
                mode={mode}
                loading={loadingAction === 'github'}
                disabled={loadingAction !== null}
                onClick={() => initiateOAuth('github')}
              />
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
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
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
            <ArrowLeftIcon className="mr-1 h-4 w-4" />
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
    </div>
  )
}
