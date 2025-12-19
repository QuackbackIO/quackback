'use client'

import { useState, useEffect, useRef } from 'react'
import { SsoLoginButton } from './sso-login-button'
import { OAuthButtons } from './oauth-buttons'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, InfoIcon, Mail, ArrowLeft } from 'lucide-react'

interface SsoProviderInfo {
  providerId: string
  issuer: string
  domain: string
}

interface OrgAuthConfig {
  found: boolean
  openSignup?: boolean
  ssoProviders?: SsoProviderInfo[]
}

interface InvitationInfo {
  id: string
  email: string
  name: string | null
  role: string | null
  workspaceName: string
  inviterName: string | null
}

interface PortalOAuthConfig {
  google: boolean
  github: boolean
}

interface OTPAuthFormProps {
  mode: 'login' | 'signup'
  authConfig?: OrgAuthConfig | null
  invitationId?: string | null
  callbackUrl?: string
  /** 'team' for team members with admin access, 'portal' for portal users */
  context?: 'team' | 'portal'
  /** Organization slug for OAuth flows */
  orgSlug?: string
  /** App domain for OAuth flows (passed from server) */
  appDomain?: string
  /** Whether to show OAuth buttons (GitHub, Google) */
  showOAuth?: boolean
  /** OAuth provider configuration (which providers are enabled) */
  oauthConfig?: PortalOAuthConfig
}

type Step = 'email' | 'code' | 'name'

/**
 * OTP Auth Form
 *
 * Unified form for login and signup using magic OTP codes.
 *
 * Login flow: email → code → redirect
 * Signup flow: email → code → name (if needed) → redirect
 * Invitation flow: email (prefilled) → code → name → redirect
 */
export function OTPAuthForm({
  mode,
  authConfig,
  invitationId,
  callbackUrl = '/',
  context = 'portal',
  orgSlug,
  appDomain,
  showOAuth = false,
  oauthConfig,
}: OTPAuthFormProps) {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [_codeSent, setCodeSent] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [loadingInvitation, setLoadingInvitation] = useState(!!invitationId)

  const codeInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

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
          setEmail(data.email) // Pre-fill email from invitation
          if (data.name) {
            setName(data.name) // Pre-fill name from invitation
          }
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
    if (step === 'name' && nameInputRef.current) {
      nameInputRef.current.focus()
    }
  }, [step])

  const sendCode = async () => {
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/tenant-otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to send code')
      }

      setCodeSent(true)
      setStep('code')
      setResendCooldown(60) // 60 second cooldown
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async (providedName?: string) => {
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/tenant-otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          code,
          name: providedName || name || undefined,
          invitationId: invitationId || undefined,
          context,
          callbackUrl,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify code')
      }

      if (data.action === 'needsSignup') {
        // User doesn't exist, need to collect name
        setStep('name')
      } else if (data.redirectUrl) {
        // Success - redirect to trust-login
        window.location.href = data.redirectUrl
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify code')
    } finally {
      setLoading(false)
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

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    verifyCode(name)
  }

  const handleResend = () => {
    if (resendCooldown > 0) return
    setCode('')
    sendCode()
  }

  const handleBack = () => {
    setError('')
    if (step === 'code') {
      setStep('email')
      setCode('')
    } else if (step === 'name') {
      setStep('code')
    }
  }

  // Determine which SSO providers to show
  const ssoProviders = authConfig?.ssoProviders ?? []
  const showSso = ssoProviders.length > 0

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

  // Signup not enabled (for team context without invitation)
  if (
    mode === 'signup' &&
    context === 'team' &&
    authConfig &&
    !authConfig.openSignup &&
    !invitation
  ) {
    return (
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertDescription>
          Signup is not enabled for this organization. Please contact your administrator for an
          invitation.
        </AlertDescription>
      </Alert>
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

      {/* OAuth Providers (GitHub, Google) - show on initial email step for non-invitation flow */}
      {/* If oauthConfig is provided, use it; otherwise fall back to showOAuth for backward compatibility */}
      {orgSlug &&
        appDomain &&
        step === 'email' &&
        !invitation &&
        (oauthConfig ? oauthConfig.github || oauthConfig.google : showOAuth) && (
          <>
            <OAuthButtons
              orgSlug={orgSlug}
              appDomain={appDomain}
              callbackUrl={callbackUrl}
              context={context}
              showGitHub={oauthConfig?.github ?? showOAuth}
              showGoogle={oauthConfig?.google ?? showOAuth}
            />
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

      {/* SSO Providers (Enterprise SAML/OIDC) - only show on initial email step for non-invitation flow */}
      {showSso && step === 'email' && !invitation && (
        <>
          <div className="space-y-3">
            {ssoProviders.map((provider) => (
              <SsoLoginButton
                key={provider.providerId}
                providerId={provider.providerId}
                issuer={provider.issuer}
                callbackUrl={callbackUrl}
              />
            ))}
          </div>
          {!showOAuth && (
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending code...
              </>
            ) : (
              'Continue with email'
            )}
          </Button>
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
              disabled={loading}
              className="text-center text-2xl tracking-widest"
              autoComplete="one-time-code"
            />
          </div>

          <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
            {loading ? (
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
              disabled={resendCooldown > 0 || loading}
              className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : "Didn't receive a code? Resend"}
            </button>
          </div>
        </form>
      )}

      {/* Step 3: Name Input (for signup when user doesn't exist) */}
      {step === 'name' && (
        <form onSubmit={handleNameSubmit} className="space-y-4">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </button>

          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-sm text-center">Email verified! Let&apos;s set up your account.</p>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Your name
            </label>
            <Input
              ref={nameInputRef}
              id="name"
              type="text"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              autoComplete="name"
            />
          </div>

          <Button type="submit" disabled={loading || !name.trim()} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : (
              'Create account'
            )}
          </Button>
        </form>
      )}
    </div>
  )
}
