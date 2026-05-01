import { useState, useEffect } from 'react'
import { OAuthButtons, getEnabledOAuthProviders } from './oauth-buttons'
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
import { authClient } from '@/lib/client/auth-client'
import { OtpCodeStep } from './otp-code-step'
import { useEmailSignin } from './use-email-signin'
import type { AuthFormStep } from './email-signin-types'
import type { PortalAuthMethods } from '@/lib/shared/types'

interface InvitationInfo {
  id: string
  email: string
  name: string | null
  role: string | null
  workspaceName: string
  inviterName: string | null
}

interface PortalAuthFormProps {
  mode?: 'login' | 'signup'
  invitationId?: string | null
  callbackUrl?: string
  /** Auth method configuration (which methods are enabled) */
  authConfig?: PortalAuthMethods
  /** Display name overrides for generic OAuth providers */
  customProviderNames?: Record<string, string>
}

/**
 * Full-page auth form for portal users. Supports password, OAuth, and the
 * combined magic-link + OTP email sign-in (POST /api/auth/portal-signin
 * mints both, server emails one message; user can either click the link
 * or type the 6-digit code).
 */
export function PortalAuthForm({
  mode = 'login',
  invitationId,
  callbackUrl = '/',
  authConfig,
  customProviderNames,
}: PortalAuthFormProps) {
  const passwordEnabled = authConfig?.password ?? true
  const magicLinkEnabled = authConfig?.magicLink ?? false
  const oauthProviders = authConfig ? getEnabledOAuthProviders(authConfig, customProviderNames) : []

  const defaultStep: AuthFormStep = !passwordEnabled && magicLinkEnabled ? 'email' : 'credentials'

  const [step, setStep] = useState<AuthFormStep>(defaultStep)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [loadingInvitation, setLoadingInvitation] = useState(!!invitationId)

  const emailSignin = useEmailSignin({
    callbackUrl,
    onSuccess: () => {
      window.location.href = callbackUrl
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

    setLoading(true)
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
      window.location.href = callbackUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  const requestSigninEmail = async () => {
    setError('')
    const res = await emailSignin.requestEmail(email)
    if (res.ok) setStep('code')
    else if (res.error) setError(res.error)
  }

  // --- Forgot password handler ---
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError('Email is required')
      return
    }

    setLoading(true)
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: '/auth/reset-password',
      })
      if (result.error) {
        throw new Error(result.error.message || 'Failed to send reset link')
      }
      setStep('reset')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset link')
    } finally {
      setLoading(false)
    }
  }

  // --- Form submit handlers ---
  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      setError('Email is required')
      return
    }
    requestSigninEmail()
  }

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    emailSignin.verify(email, emailSignin.code)
  }

  const handleResend = () => emailSignin.resend(email)

  const handleBack = () => {
    setError('')
    emailSignin.reset()
    setStep(defaultStep)
  }

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

  // Determine what's visible on the default step
  const showOAuthOnDefault =
    (step === 'credentials' || step === 'email') && !invitation && oauthProviders.length > 0
  const hasCredentialForm = step === 'credentials' && passwordEnabled
  const hasEmailForm = step === 'email' && magicLinkEnabled

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

      {/* OAuth Providers - show on default step for non-invitation flow */}
      {showOAuthOnDefault && (
        <>
          <OAuthButtons callbackUrl={callbackUrl} providers={oauthProviders} />
          {/* Divider - only show when another method is also enabled below */}
          {(passwordEnabled || magicLinkEnabled) && (
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
          )}
        </>
      )}

      {/* Password credentials form (default when password enabled) */}
      {hasCredentialForm && (
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {error && <FormError message={error} />}

          {mode === 'signup' && (
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="name"
                type="text"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                autoComplete="name"
              />
            </div>
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
              disabled={!!invitation || loading}
              className={invitation ? 'bg-muted' : ''}
              autoComplete="email"
            />
            {invitation && (
              <p className="text-xs text-muted-foreground">Email is set from your invitation</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Input
              id="password"
              type="password"
              placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
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

          <Button type="submit" disabled={loading} className="w-full">
            {loading && <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />}
            {loading
              ? mode === 'signup'
                ? 'Creating account...'
                : 'Signing in...'
              : mode === 'signup'
                ? 'Create account'
                : 'Sign in'}
          </Button>

          {/* Link to email sign-in if also enabled */}
          {magicLinkEnabled && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setStep('email')
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Sign in with email instead
              </button>
            </div>
          )}
        </form>
      )}

      {/* Magic-link: email input step */}
      {hasEmailForm && (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          {error && <FormError message={error} />}

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
              disabled={!!invitation || loading}
              className={invitation ? 'bg-muted' : ''}
              autoComplete="email"
            />
            {invitation && (
              <p className="text-xs text-muted-foreground">Email is set from your invitation</p>
            )}
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? (
              <>
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                Sending email…
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
        </form>
      )}

      {step === 'code' && (
        <OtpCodeStep
          email={email}
          code={emailSignin.code}
          onCodeChange={emailSignin.setCode}
          onComplete={(otp) => emailSignin.verify(email, otp)}
          onSubmit={handleCodeSubmit}
          onResend={handleResend}
          onBack={handleBack}
          loading={emailSignin.loading}
          error={emailSignin.error}
          resendCooldown={emailSignin.resendCooldown}
          showInnerHeader
        />
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
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>
          </div>

          {error && <FormError message={error} />}

          <div className="space-y-2">
            <label htmlFor="forgot-email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="forgot-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <Button type="submit" disabled={loading || !email.trim()} className="w-full">
            {loading ? (
              <>
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                Sending link...
              </>
            ) : (
              'Send reset link'
            )}
          </Button>
        </form>
      )}

      {/* Reset password: check email confirmation */}
      {step === 'reset' && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="mr-1 h-4 w-4" />
            Back
          </button>

          <div className="text-center space-y-3">
            <EnvelopeIcon className="h-10 w-10 text-primary mx-auto" />
            <h2 className="text-lg font-semibold">Check your email</h2>
            <p className="text-sm text-muted-foreground">
              We sent a password reset link to{' '}
              <span className="font-medium text-foreground">{email}</span>. The link expires in 24
              hours.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
