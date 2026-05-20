import { useState, useEffect } from 'react'
import { useServerFn } from '@tanstack/react-start'
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
  ShieldCheckIcon,
} from '@heroicons/react/24/solid'
import { authClient } from '@/lib/client/auth-client'
import { stashTwoFactorCallbackUrl } from '@/lib/server/auth/client'
import {
  lookupAuthMethodsFn,
  SSO_UNAVAILABLE_MESSAGE,
  type LookupAuthMethodsResult,
} from '@/lib/server/functions/auth'
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
  /** Pre-filled email — used by the team-login dispatcher when the
   *  user's email didn't match the verified SSO domain and we hand
   *  control off to the methods form. Presence of this prop skips
   *  Stage 1 entirely and lands directly on the methods stage with
   *  the email locked. */
  initialEmail?: string
  /** Workspace display name shown in Stage 1 / Stage 2 copy. */
  workspaceName?: string
  /** When false + mode=signup + unknown email, we render a "no account /
   *  signups closed" block instead of the methods form. */
  openSignup?: boolean
  /** Switch login ↔ signup mode (used on Stage 1's footer link). The
   *  full-page form normally uses a Link in its shell footer; this prop
   *  lets shared callers swap modes without leaving the form. */
  onModeSwitch?: (mode: 'login' | 'signup') => void
}

/**
 * Full-page auth form for portal users. Email-first two-stage flow:
 *
 *  Stage 1 (`email`): OAuth tiles + single email field + Continue.
 *    Clicking Continue calls `lookupAuthMethodsFn` and routes to one
 *    of four Stage 2 sub-screens based on `result.kind`.
 *
 *  Stage 2:
 *    - `sso-redirect` → immediate `authClient.signIn.oauth2(...)`; the
 *      browser navigates to the IdP. We never sit on a button here.
 *    - `sso-default`  → "Workspace uses SSO" + Continue with SSO +
 *      "Sign in another way" escape hatch into the methods form.
 *    - `methods`      → password + magic link form, email locked at top.
 *    - `sso-unavailable` → `SSO_UNAVAILABLE_MESSAGE` + back link.
 *
 *  Special case: `mode === 'signup'` + `kind === 'methods'` + `openSignup
 *  === false` → "no account / signups closed" block.
 *
 *  Invitation flow: when `invitationId` is present + the invitation
 *  loads, the email is server-known so Stage 1 is skipped and we land
 *  directly on the methods sub-screen with the email locked.
 */
export function PortalAuthForm({
  mode = 'login',
  invitationId,
  callbackUrl = '/',
  authConfig,
  customProviderNames,
  initialEmail,
  workspaceName,
  openSignup,
  onModeSwitch,
}: PortalAuthFormProps) {
  const passwordEnabled = authConfig?.password ?? true
  const magicLinkEnabled = authConfig?.magicLink ?? false
  const oauthProviders = authConfig ? getEnabledOAuthProviders(authConfig, customProviderNames) : []

  // Stage 1 + Stage 2 sub-screens. `methods-step` carries the inner
  // step (the existing `AuthFormStep` union — credentials | email | code
  // | forgot | reset). The other branches are stage-level only.
  type View =
    | { stage: 'email' }
    | { stage: 'methods-step'; step: AuthFormStep }
    | { stage: 'sso-default' }
    | { stage: 'sso-unavailable' }
    | { stage: 'closed-signup' }
    | { stage: 'sso-redirecting' }

  // Start state: invitation OR initialEmail bypasses Stage 1.
  const skipStage1 = !!(initialEmail || invitationId)
  const methodsDefaultStep: AuthFormStep =
    !passwordEnabled && magicLinkEnabled ? 'email' : 'credentials'
  const [view, setView] = useState<View>(
    skipStage1 ? { stage: 'methods-step', step: methodsDefaultStep } : { stage: 'email' }
  )

  const [name, setName] = useState('')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [continueLoading, setContinueLoading] = useState(false)
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [loadingInvitation, setLoadingInvitation] = useState(!!invitationId)

  const lookupAuthMethods = useServerFn(lookupAuthMethodsFn)

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
          setView({ stage: 'methods-step', step: methodsDefaultStep })
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
  }, [invitationId, methodsDefaultStep])

  // --- Stage 1 → Stage 2 transition ---
  const continueFromEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Email is required')
      return
    }

    setContinueLoading(true)
    try {
      const result: LookupAuthMethodsResult = await lookupAuthMethods({
        data: { email: trimmed, surface: 'portal' },
      })
      if (result.kind === 'sso-redirect') {
        // Same-tab redirect to IdP — show a transient spinner while the
        // browser bounces. `authClient.signIn.oauth2` navigates away so
        // we never re-render past this point in the happy path.
        // Pass the typed email as `loginHint` so the IdP pre-selects
        // that account in its picker.
        setView({ stage: 'sso-redirecting' })
        await authClient.signIn.oauth2({
          providerId: 'sso',
          callbackURL: callbackUrl,
          additionalData: { loginHint: trimmed },
        })
        return
      }
      if (result.kind === 'sso-default') {
        setView({ stage: 'sso-default' })
        return
      }
      if (result.kind === 'sso-unavailable') {
        setView({ stage: 'sso-unavailable' })
        return
      }
      // `methods` — unknown domain. Block signup-mode users when the
      // workspace has signups closed.
      if (mode === 'signup' && openSignup === false) {
        setView({ stage: 'closed-signup' })
        return
      }
      setView({ stage: 'methods-step', step: methodsDefaultStep })
    } catch (err) {
      setError((err as Error).message || 'Something went wrong. Please try again.')
    } finally {
      setContinueLoading(false)
    }
  }

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
        // Stash the post-auth destination so the twoFactor client can
        // splice it onto its `/auth/two-factor` redirect if the user
        // gets challenged (Better-Auth's own redirect drops it).
        stashTwoFactorCallbackUrl(callbackUrl)
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
    if (res.ok) setView({ stage: 'methods-step', step: 'code' })
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
      setView({ stage: 'methods-step', step: 'reset' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset link')
    } finally {
      setLoading(false)
    }
  }

  // --- Magic-link email submit (Stage 2's "email me a link" path) ---
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

  /** Stage 2 → Stage 1 escape hatch. Clears the lookup result and the
   *  OTP state so the user can switch emails without seeing stale chrome. */
  const backToEmail = () => {
    setError('')
    setPassword('')
    emailSignin.reset()
    setView({ stage: 'email' })
  }

  /** Inside the methods sub-form, drop back to the methods default step
   *  (e.g. from the forgot/reset/code sub-screens). */
  const backToMethods = () => {
    setError('')
    emailSignin.reset()
    setView({ stage: 'methods-step', step: methodsDefaultStep })
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

  // Invitation banner (shown above the methods sub-form when an invite
  // brought the user here).
  const invitationBanner = invitation && (
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
  )

  // ============================================================
  // Stage 1 — email entry
  // ============================================================
  if (view.stage === 'email') {
    return (
      <div className="space-y-6">
        {/* OAuth tiles bypass Stage 2 entirely. */}
        {oauthProviders.length > 0 && (
          <>
            <OAuthButtons callbackUrl={callbackUrl} providers={oauthProviders} />
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>
          </>
        )}

        <form onSubmit={continueFromEmail} className="space-y-4">
          {error && <FormError message={error} />}
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={continueLoading}
              required
            />
          </div>
          <Button type="submit" disabled={continueLoading || !email.trim()} className="w-full">
            {continueLoading ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <>Continue &rarr;</>
            )}
          </Button>
        </form>

        {onModeSwitch && (
          <p className="text-center text-sm text-muted-foreground">
            {mode === 'login' ? (
              <>
                New here?{' '}
                <button
                  type="button"
                  onClick={() => onModeSwitch('signup')}
                  className="text-primary hover:underline font-medium"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Have an account?{' '}
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
      </div>
    )
  }

  // ============================================================
  // Stage 2 — transient SSO redirect spinner
  // ============================================================
  if (view.stage === 'sso-redirecting') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <ArrowPathIcon className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Signing you in&hellip;</p>
      </div>
    )
  }

  // ============================================================
  // Stage 2 — sso-default branch
  // ============================================================
  if (view.stage === 'sso-default') {
    return (
      <div className="space-y-4">
        <BackToEmailLink onClick={backToEmail} />
        <div className="space-y-2 text-center">
          <ShieldCheckIcon className="mx-auto h-8 w-8 text-primary" />
          <p className="text-sm text-muted-foreground">
            {workspaceName ? (
              <>
                <span className="font-medium text-foreground">{workspaceName}</span> uses single
                sign-on for your team domain.
              </>
            ) : (
              <>Your team domain uses single sign-on.</>
            )}
          </p>
        </div>
        {error && <FormError message={error} />}
        <Button
          type="button"
          className="w-full"
          onClick={async () => {
            setError('')
            setLoading(true)
            try {
              setView({ stage: 'sso-redirecting' })
              const trimmed = email.trim()
              await authClient.signIn.oauth2({
                providerId: 'sso',
                callbackURL: callbackUrl,
                additionalData: trimmed ? { loginHint: trimmed } : undefined,
              })
            } catch (err) {
              setError((err as Error).message || 'Could not start SSO sign-in.')
              setView({ stage: 'sso-default' })
              setLoading(false)
            }
          }}
          disabled={loading}
        >
          {loading ? (
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <ShieldCheckIcon className="mr-2 h-4 w-4" />
              Continue with SSO
            </>
          )}
        </Button>
        <button
          type="button"
          onClick={() => {
            setError('')
            setView({ stage: 'methods-step', step: methodsDefaultStep })
          }}
          className="block w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          disabled={loading}
        >
          Sign in another way
        </button>
      </div>
    )
  }

  // ============================================================
  // Stage 2 — sso-unavailable branch
  // ============================================================
  if (view.stage === 'sso-unavailable') {
    return (
      <div className="space-y-4">
        <BackToEmailLink onClick={backToEmail} />
        <Alert variant="destructive">
          <InformationCircleIcon className="h-4 w-4" />
          <AlertDescription>{SSO_UNAVAILABLE_MESSAGE}</AlertDescription>
        </Alert>
      </div>
    )
  }

  // ============================================================
  // Stage 2 — closed-signup branch
  // ============================================================
  if (view.stage === 'closed-signup') {
    return (
      <div className="space-y-4">
        <BackToEmailLink onClick={backToEmail} />
        <div className="space-y-2 text-center">
          <h2 className="text-lg font-semibold">No account found</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{email}</span> doesn&apos;t have an
            account on this workspace, and new sign-ups are off. Ask your workspace admin to invite
            you.
          </p>
        </div>
        {onModeSwitch && (
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => {
                onModeSwitch('login')
                setView({ stage: 'email' })
              }}
              className="text-primary hover:underline font-medium"
            >
              Sign in
            </button>
          </p>
        )}
      </div>
    )
  }

  // ============================================================
  // Stage 2 — methods (password / magic link / forgot / reset / code)
  // ============================================================
  const step = view.step
  const showBack = !invitation && !initialEmail
  const lockEmail = !!invitation || !!initialEmail

  return (
    <div className="space-y-6">
      {invitationBanner}

      {/* Header for the methods sub-form: friendly title + read-only email */}
      {(step === 'credentials' || step === 'email') && (
        <>
          {showBack && <BackToEmailLink onClick={backToEmail} />}
          <div className="space-y-1 text-center">
            <h2 className="text-lg font-semibold">
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </h2>
            {email && <p className="text-sm text-muted-foreground break-all">{email}</p>}
          </div>
        </>
      )}

      {/* Password credentials form */}
      {step === 'credentials' && passwordEnabled && (
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

          {/* Email is fixed at this stage — hidden field keeps password
              managers happy. */}
          <input type="hidden" name="email" value={email} autoComplete="email" readOnly />

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
              autoFocus
            />
          </div>

          {mode === 'login' && (
            <div className="text-right">
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setView({ stage: 'methods-step', step: 'forgot' })
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

          {/* Magic-link cross-link if also enabled */}
          {magicLinkEnabled && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setView({ stage: 'methods-step', step: 'email' })
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Email me a sign-in link instead
              </button>
            </div>
          )}
        </form>
      )}

      {/* Magic-link only: when password is disabled, the methods step
          lands here directly. */}
      {step === 'email' && magicLinkEnabled && (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          {error && <FormError message={error} />}

          <input type="hidden" name="email" value={email} autoComplete="email" readOnly />

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

          {/* Back to password if also enabled */}
          {passwordEnabled && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setView({ stage: 'methods-step', step: 'credentials' })
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
          onBack={backToMethods}
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
            onClick={backToMethods}
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
              disabled={loading || lockEmail}
              className={lockEmail ? 'bg-muted' : ''}
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
            onClick={backToMethods}
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

/** Stage 2 → Stage 1 escape hatch. Kept on every Stage 2 sub-screen so
 *  the user is never trapped by a typo. */
function BackToEmailLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon className="mr-1 h-4 w-4" />
      Use a different email
    </button>
  )
}
