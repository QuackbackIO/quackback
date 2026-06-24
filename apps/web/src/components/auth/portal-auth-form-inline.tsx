import { useState, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useIntl, FormattedMessage } from 'react-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { FormError } from '@/components/shared/form-error'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  ArrowPathIcon,
  InformationCircleIcon,
  EnvelopeIcon,
  ArrowLeftIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/solid'
import { AUTH_PROVIDER_ICON_MAP } from '@/components/icons/social-provider-icons'
import {
  getEnabledOAuthProviders,
  getOAuthRedirectUrl,
  hasRoutableOidcProvider,
  type OAuthProviderEntry,
  type OidcProviderEntry,
} from '@/components/auth/oauth-buttons'
import {
  openAuthPopup,
  usePopupTracker,
  postAuthSuccess,
} from '@/lib/client/hooks/use-auth-broadcast'
import { authClient } from '@/lib/client/auth-client'
import { isTeamCallback } from '@/lib/shared/routing'
import { lookupAuthMethodsFn, type LookupAuthMethodsResult } from '@/lib/server/functions/auth'
import { OtpCodeStep } from './otp-code-step'
import { useEmailSignin } from './use-email-signin'
import { TwoFactorEnrollSteps } from './two-factor-enroll-steps'
import { TwoFactorChallengeStep } from './two-factor-challenge-step'
import type { AuthFormStep } from './email-signin-types'

interface OrgAuthConfig {
  found: boolean
  oauth: Record<string, boolean | undefined>
  openSignup?: boolean
  /** Public OIDC sign-in buttons from the identity_provider list. */
  oidcProviders?: OidcProviderEntry[]
  /** All registered auth provider ids (OIDC registrationIds + social ids).
   *  Lets the form show the email input for a routed-only IdP that has no
   *  public button — a domain email is the only way to reach it. */
  registeredAuthProviders?: string[]
  /** Workspace requires 2FA — drives inline enrollment after password sign-in. */
  twoFactorRequired?: boolean
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
  /** Workspace display name shown in Stage 1 / Stage 2 copy. */
  workspaceName?: string
  callbackUrl?: string
  onModeSwitch?: (mode: 'login' | 'signup') => void
  /** Lets the surrounding dialog adapt its header to the form's step. */
  onContextChange?: (ctx: { step: AuthFormStep; email: string }) => void
}

/**
 * Named cases for `loadingAction` plus any provider id at runtime. The
 * `(string & {})` trick keeps autocomplete on the literal cases while
 * still allowing arbitrary provider ids; a typo at a setter site narrows
 * to the literal union and surfaces as a type error.
 */
type LoadingAction = 'password' | 'email' | 'sso' | 'forgot' | 'continue' | (string & {})

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
      {mode === 'login' ? (
        <FormattedMessage
          id="portal.auth.oauth.signInWith"
          defaultMessage="Sign in with {provider}"
          values={{ provider: label }}
        />
      ) : (
        <FormattedMessage
          id="portal.auth.oauth.signUpWith"
          defaultMessage="Sign up with {provider}"
          values={{ provider: label }}
        />
      )}
    </Button>
  )
}

/**
 * Inline Portal Auth Form for use in dialogs/popovers.
 *
 * Email-first two-stage flow:
 *
 *  Stage 1 (`email`): OAuth tiles + email field + Continue. OAuth tiles
 *    bypass Stage 2 entirely (popup-driven, not redirect-driven, since
 *    the form lives inside a dialog).
 *
 *  Stage 2: routed by `lookupAuthMethodsFn` —
 *    - `sso-redirect`     → `authClient.signIn.oauth2(...)` same-tab
 *      (the dialog is closing anyway since the page navigates).
 *    - `sso-default`      → "Workspace uses SSO" card + escape hatch.
 *    - `methods`          → password + magic-link form, email locked.
 *    - Special: signup-mode + unknown email + openSignup=false →
 *      "no account / signups closed" block.
 *
 *  Every Stage 2 sub-screen has a `← Use a different email` link that
 *  returns to Stage 1, clearing the cached lookup + error state.
 */
export function PortalAuthFormInline({
  mode,
  authConfig,
  invitationId,
  workspaceName,
  callbackUrl,
  onModeSwitch,
  onContextChange,
}: PortalAuthFormInlineProps) {
  const intl = useIntl()
  const effectiveCallbackUrl = callbackUrl ?? '/'
  const showRecoveryLink = isTeamCallback(callbackUrl)
  const passwordEnabled = authConfig?.oauth?.password ?? true
  const magicLinkEnabled = authConfig?.oauth?.magicLink ?? false
  const openSignup = authConfig?.openSignup
  const twoFactorRequired = authConfig?.twoFactorRequired ?? false
  const methodsDefaultStep: AuthFormStep =
    !passwordEnabled && magicLinkEnabled ? 'email' : 'credentials'

  // Stage 2 sub-screens. `methods-step` carries the inner step (the
  // existing `AuthFormStep` union — credentials | email | code | forgot
  // | reset). The other branches are stage-level only.
  type View =
    | { stage: 'email' }
    | { stage: 'methods-step'; step: AuthFormStep }
    | { stage: 'sso-default'; providerId: string }
    | { stage: 'closed-signup' }
    | { stage: 'sso-redirecting' }
    | { stage: 'two-factor-challenge' }
    | { stage: 'two-factor-enroll' }

  // Invitation flow: the email is server-known, so Stage 1 is moot.
  const [view, setView] = useState<View>(
    invitationId ? { stage: 'methods-step', step: methodsDefaultStep } : { stage: 'email' }
  )

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loadingAction, setLoadingAction] = useState<LoadingAction | null>(null)
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [loadingInvitation, setLoadingInvitation] = useState(!!invitationId)
  const [popupBlocked, setPopupBlocked] = useState(false)

  const lookupAuthMethods = useServerFn(lookupAuthMethodsFn)

  const emailSignin = useEmailSignin({
    callbackUrl: effectiveCallbackUrl,
    onSuccess: () => {
      postAuthSuccess()
    },
  })

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
          setView({ stage: 'methods-step', step: methodsDefaultStep })
        } else {
          const data = (await response.json()) as { error?: string }
          setError(
            data.error ||
              intl.formatMessage({
                id: 'portal.auth.error.invitationInvalid',
                defaultMessage: 'Invalid or expired invitation',
              })
          )
        }
      } catch {
        setError(
          intl.formatMessage({
            id: 'portal.auth.error.invitationLoadFailed',
            defaultMessage: 'Failed to load invitation',
          })
        )
      } finally {
        setLoadingInvitation(false)
      }
    }

    fetchInvitation()
  }, [invitationId, methodsDefaultStep])

  useEffect(() => {
    return () => clearPopup()
  }, [clearPopup])

  // Surface the form's current "step" to the surrounding dialog so it
  // can adapt its header. We map stage-level sub-screens onto the
  // existing `AuthFormStep` union (the dialog header already knows
  // `code` / `forgot` / `reset`); the other stages fall back to
  // `credentials` so the dialog renders the default Welcome / Create
  // header until the user lands inside the methods form.
  useEffect(() => {
    const step: AuthFormStep = view.stage === 'methods-step' ? view.step : 'credentials'
    onContextChange?.({ step, email })
  }, [view, email, onContextChange])

  // --- Stage 1 → Stage 2 transition ---
  const continueFromEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const trimmed = email.trim()
    if (!trimmed) {
      setError(
        intl.formatMessage({
          id: 'portal.auth.error.emailRequired',
          defaultMessage: 'Email is required',
        })
      )
      return
    }

    setLoadingAction('continue')
    try {
      const result: LookupAuthMethodsResult = await lookupAuthMethods({
        data: { email: trimmed },
      })
      if (result.kind === 'sso-redirect') {
        setView({ stage: 'sso-redirecting' })
        setLoadingAction('sso')
        await authClient.signIn.oauth2({
          providerId: result.providerId,
          callbackURL: effectiveCallbackUrl,
        })
        return
      }
      if (result.kind === 'sso-default') {
        setView({ stage: 'sso-default', providerId: result.providerId })
        return
      }
      if (mode === 'signup' && openSignup === false) {
        setView({ stage: 'closed-signup' })
        return
      }
      setView({ stage: 'methods-step', step: methodsDefaultStep })
    } catch (err) {
      setError(
        (err as Error).message ||
          intl.formatMessage({
            id: 'portal.auth.error.generic',
            defaultMessage: 'Something went wrong. Please try again.',
          })
      )
    } finally {
      setLoadingAction((prev) => (prev === 'continue' ? null : prev))
    }
  }

  // --- Password auth handler ---
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError(
        intl.formatMessage({
          id: 'portal.auth.error.emailRequired',
          defaultMessage: 'Email is required',
        })
      )
      return
    }
    if (!password) {
      setError(
        intl.formatMessage({
          id: 'portal.auth.error.passwordRequired',
          defaultMessage: 'Password is required',
        })
      )
      return
    }
    if (mode === 'signup' && password.length < 8) {
      setError(
        intl.formatMessage({
          id: 'portal.auth.error.passwordTooShort',
          defaultMessage: 'Password must be at least 8 characters',
        })
      )
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
          throw new Error(
            result.error.message ||
              intl.formatMessage({
                id: 'portal.auth.error.createAccountFailed',
                defaultMessage: 'Failed to create account',
              })
          )
        }
      } else {
        const result = await authClient.signIn.email({
          email,
          password,
        })
        if (result.error) {
          throw new Error(
            result.error.message ||
              intl.formatMessage({
                id: 'portal.auth.error.invalidCredentials',
                defaultMessage: 'Invalid email or password',
              })
          )
        }
        // better-auth's twoFactor plugin injects this field at runtime but
        // the client type doesn't declare it — cast to surface it safely.
        if (
          (result.data as { twoFactorRedirect?: boolean } | null | undefined)?.twoFactorRedirect
        ) {
          setView({ stage: 'two-factor-challenge' })
          setLoadingAction(null)
          return
        }
      }
      // A full session under a 2FA-required workspace can only mean the user
      // is not enrolled (enrolled users get twoFactorRedirect, no session).
      if (twoFactorRequired) {
        setView({ stage: 'two-factor-enroll' })
        setLoadingAction(null)
        return
      }
      postAuthSuccess()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'portal.auth.error.authFailed',
              defaultMessage: 'Authentication failed',
            })
      )
      setLoadingAction(null)
    }
  }

  const requestSigninEmail = async () => {
    setError('')
    setLoadingAction('email')
    const res = await emailSignin.requestEmail(email)
    setLoadingAction(null)
    if (res.ok) setView({ stage: 'methods-step', step: 'code' })
    else if (res.error) setError(res.error)
  }

  // --- Forgot password handler ---
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError(
        intl.formatMessage({
          id: 'portal.auth.error.emailRequired',
          defaultMessage: 'Email is required',
        })
      )
      return
    }

    setLoadingAction('forgot')
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: '/auth/reset-password',
      })
      if (result.error) {
        throw new Error(
          result.error.message ||
            intl.formatMessage({
              id: 'portal.auth.error.resetLinkFailed',
              defaultMessage: 'Failed to send reset link',
            })
        )
      }
      setView({ stage: 'methods-step', step: 'reset' })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'portal.auth.error.resetLinkFailed',
              defaultMessage: 'Failed to send reset link',
            })
      )
    } finally {
      setLoadingAction(null)
    }
  }

  // --- Form submit handlers ---
  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      setError(
        intl.formatMessage({
          id: 'portal.auth.error.emailRequired',
          defaultMessage: 'Email is required',
        })
      )
      return
    }
    requestSigninEmail()
  }

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    emailSignin.verify(email, emailSignin.code)
  }

  const handleResend = () => emailSignin.resend(email)

  /** Stage 2 → Stage 1 escape hatch. */
  const backToEmail = () => {
    setError('')
    setPassword('')
    emailSignin.reset()
    setView({ stage: 'email' })
  }

  /** Inside the methods sub-form, drop back to the methods default step. */
  const backToMethods = () => {
    setError('')
    emailSignin.reset()
    setView({ stage: 'methods-step', step: methodsDefaultStep })
  }

  /**
   * Initiate OAuth login using Better Auth's socialProviders or
   * genericOAuth plugin. Only available at Stage 1 — once the user has
   * committed to an email, the tile UX is moot.
   */
  const initiateOAuth = async (provider: OAuthProviderEntry) => {
    setError('')

    if (hasPopup()) {
      focusPopup()
      return
    }

    setLoadingAction(provider.id)
    setPopupBlocked(false)

    const popup = openAuthPopup('about:blank')
    if (!popup) {
      setPopupBlocked(true)
      setLoadingAction(null)
      return
    }
    trackPopup(popup)

    try {
      const url = await getOAuthRedirectUrl(provider, '/auth/auth-complete')
      if (url) {
        popup.location.href = url
      } else {
        popup.close()
        setError(
          intl.formatMessage({
            id: 'portal.auth.error.initiateSignInFailed',
            defaultMessage: 'Failed to initiate sign in',
          })
        )
        setLoadingAction(null)
      }
    } catch (err) {
      popup.close()
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'portal.auth.error.initiateSignInFailed',
              defaultMessage: 'Failed to initiate sign in',
            })
      )
      setLoadingAction(null)
    }
  }

  // Derive which auth methods are enabled
  const enabledProviders = getEnabledOAuthProviders(
    authConfig?.oauth ?? {},
    authConfig?.oidcProviders
  )
  const showOAuth = enabledProviders.length > 0
  // Email entry makes sense when a portal email method is enabled (password or
  // magic-link), OR when a routed-only IdP exists — entering a domain email is
  // the only way to reach a provider that renders no public button. Without
  // either, Stage 2 would dead-end, so we show only the OAuth tiles. (#231)
  const emailEntryEnabled =
    passwordEnabled ||
    magicLinkEnabled ||
    hasRoutableOidcProvider(authConfig?.registeredAuthProviders, authConfig?.oidcProviders)

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
            <FormattedMessage
              id="portal.auth.popupBlocked"
              defaultMessage="Popup was blocked by your browser. Please allow popups for this site and try again."
            />
          </AlertDescription>
        </Alert>
        <Button onClick={() => setPopupBlocked(false)} variant="outline" className="w-full">
          <FormattedMessage id="portal.auth.tryAgain" defaultMessage="Try again" />
        </Button>
      </div>
    )
  }

  const invitationBanner = invitation && (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <EnvelopeIcon className="h-5 w-5 text-primary mt-0.5" />
        <div>
          <p className="font-medium text-foreground">
            <FormattedMessage id="portal.auth.invite.title" defaultMessage="You've been invited!" />
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            <FormattedMessage
              id="portal.auth.invite.body"
              defaultMessage="Create your account to join {workspace}"
              values={{
                workspace: (
                  <span className="font-medium text-foreground">{invitation.workspaceName}</span>
                ),
              }}
            />
            {invitation.inviterName && (
              <FormattedMessage
                id="portal.auth.invite.invitedBy"
                defaultMessage=" (invited by {inviter})"
                values={{ inviter: invitation.inviterName }}
              />
            )}
          </p>
        </div>
      </div>
    </div>
  )

  // Break-glass for a team member whose only way in is SSO when SSO is down.
  // Rendered ONLY in the SSO views (not the password/email forms, where a
  // recovery code is irrelevant) and gated to team-bound sign-in via
  // showRecoveryLink, so portal users never see it.
  const recoveryLink = showRecoveryLink ? (
    <p className="text-center text-sm text-muted-foreground">
      <FormattedMessage id="portal.auth.ssoUnavailable" defaultMessage="SSO unavailable?" />{' '}
      <Link
        to="/auth/recovery"
        className="font-medium text-foreground hover:underline underline-offset-4"
      >
        <FormattedMessage id="portal.auth.useRecoveryCode" defaultMessage="Use a recovery code" />
      </Link>
    </p>
  ) : null

  // ============================================================
  // Stage 1 — email entry
  // ============================================================
  if (view.stage === 'email') {
    return (
      <div className="space-y-6">
        {/* OAuth tile failures (initiateOAuth) set `error` too, so surface it
            above both paths — not only inside the email form, which is hidden in
            OAuth-only setups. */}
        {error && <FormError message={error} />}
        {showOAuth && (
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
                    onClick={() => initiateOAuth(provider)}
                  />
                )
              })}
            </div>
            {/* Divider only when an email path follows the tiles. */}
            {emailEntryEnabled && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-background px-2 text-muted-foreground">
                    <FormattedMessage id="portal.auth.dividerOr" defaultMessage="or" />
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {emailEntryEnabled && (
          <>
            <form onSubmit={continueFromEmail} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="inline-email">
                  <FormattedMessage id="portal.auth.email.label" defaultMessage="Email" />
                </Label>
                <Input
                  id="inline-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder={intl.formatMessage({
                    id: 'portal.auth.email.placeholder',
                    defaultMessage: 'you@example.com',
                  })}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loadingAction !== null}
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={loadingAction !== null || !email.trim()}
                className="w-full"
              >
                {loadingAction === 'continue' ? (
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <FormattedMessage id="portal.auth.continue" defaultMessage="Continue" /> &rarr;
                  </>
                )}
              </Button>
            </form>

            {onModeSwitch && (
              <p className="text-center text-sm text-muted-foreground">
                {mode === 'login' ? (
                  <>
                    <FormattedMessage id="portal.auth.switch.newHere" defaultMessage="New here?" />{' '}
                    <button
                      type="button"
                      onClick={() => onModeSwitch('signup')}
                      className="text-primary hover:underline font-medium"
                    >
                      <FormattedMessage
                        id="portal.auth.switch.createAccount"
                        defaultMessage="Create an account"
                      />
                    </button>
                  </>
                ) : (
                  <>
                    <FormattedMessage
                      id="portal.auth.switch.haveAccount"
                      defaultMessage="Have an account?"
                    />{' '}
                    <button
                      type="button"
                      onClick={() => onModeSwitch('login')}
                      className="text-primary hover:underline font-medium"
                    >
                      <FormattedMessage id="portal.auth.switch.signIn" defaultMessage="Sign in" />
                    </button>
                  </>
                )}
              </p>
            )}
          </>
        )}

        {/* Break-glass only in the SSO-only Stage 1 — just the SSO button, no
            email/password path in front of the admin. Elsewhere the recovery
            link belongs in the SSO views, not this generic stage. */}
        {showOAuth && !emailEntryEnabled && recoveryLink}

        {/* Misconfiguration safety net — updatePortalConfig blocks saving zero
            methods, but never strand the user on a blank card if it happens. */}
        {!showOAuth && !emailEntryEnabled && (
          <p className="text-center text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.auth.noMethods"
              defaultMessage="No sign-in methods are configured. Contact your workspace administrator."
            />
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
        <p className="text-sm text-muted-foreground">
          <FormattedMessage id="portal.auth.sso.redirecting" defaultMessage="Signing you in…" />
        </p>
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
              <FormattedMessage
                id="portal.auth.sso.usesSSONamed"
                defaultMessage="{workspace} uses single sign-on for your team domain."
                values={{
                  workspace: <span className="font-medium text-foreground">{workspaceName}</span>,
                }}
              />
            ) : (
              <FormattedMessage
                id="portal.auth.sso.usesSSO"
                defaultMessage="Your team domain uses single sign-on."
              />
            )}
          </p>
        </div>
        {error && <FormError message={error} />}
        <Button
          type="button"
          className="w-full"
          onClick={async () => {
            setError('')
            setLoadingAction('sso')
            try {
              setView({ stage: 'sso-redirecting' })
              await authClient.signIn.oauth2({
                providerId: view.providerId,
                callbackURL: effectiveCallbackUrl,
              })
            } catch (err) {
              setError(
                (err as Error).message ||
                  intl.formatMessage({
                    id: 'portal.auth.error.ssoStartFailed',
                    defaultMessage: 'Could not start SSO sign-in.',
                  })
              )
              setView({ stage: 'sso-default', providerId: view.providerId })
              setLoadingAction(null)
            }
          }}
          disabled={loadingAction !== null}
        >
          {loadingAction === 'sso' ? (
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <ShieldCheckIcon className="mr-2 h-4 w-4" />
              <FormattedMessage id="portal.auth.sso.continue" defaultMessage="Continue with SSO" />
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
          disabled={loadingAction !== null}
        >
          <FormattedMessage id="portal.auth.sso.another" defaultMessage="Sign in another way" />
        </button>
        {recoveryLink}
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
          <h2 className="text-lg font-semibold">
            <FormattedMessage id="portal.auth.noAccount.title" defaultMessage="No account found" />
          </h2>
          <p className="text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.auth.noAccount.body"
              defaultMessage="{email} doesn't have an account on this workspace, and new sign-ups are off. Ask your workspace admin to invite you."
              values={{ email: <span className="font-medium text-foreground">{email}</span> }}
            />
          </p>
        </div>
        {onModeSwitch && (
          <p className="text-center text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.auth.noAccount.haveAccount"
              defaultMessage="Already have an account?"
            />{' '}
            <button
              type="button"
              onClick={() => {
                onModeSwitch('login')
                setView({ stage: 'email' })
              }}
              className="text-primary hover:underline font-medium"
            >
              <FormattedMessage id="portal.auth.signIn" defaultMessage="Sign in" />
            </button>
          </p>
        )}
      </div>
    )
  }

  // ============================================================
  // Stage 2 — two-factor challenge (enrolled user, better-auth returned
  // twoFactorRedirect)
  // ============================================================
  if (view.stage === 'two-factor-challenge') {
    return (
      <TwoFactorChallengeStep
        onComplete={postAuthSuccess}
        onCancel={async () => {
          try {
            await authClient.signOut()
          } finally {
            setError('')
            setView({ stage: 'methods-step', step: methodsDefaultStep })
          }
        }}
      />
    )
  }

  // ============================================================
  // Stage 2 — two-factor enrollment (unenrolled user under a workspace
  // that requires 2FA — enrolled users get twoFactorRedirect instead)
  // ============================================================
  if (view.stage === 'two-factor-enroll') {
    return (
      <TwoFactorEnrollSteps
        password={password}
        onComplete={postAuthSuccess}
        onCancel={async () => {
          try {
            await authClient.signOut()
          } finally {
            setError('')
            setView({ stage: 'methods-step', step: methodsDefaultStep })
          }
        }}
      />
    )
  }

  // ============================================================
  // Stage 2 — methods (password / magic link / forgot / reset / code)
  // ============================================================
  const step = view.step
  const showBack = !invitation

  return (
    <div className="space-y-6">
      {invitationBanner}

      {(step === 'credentials' || step === 'email') && (
        // Show the entered email as a filled, locked field (the dialog header
        // already greets the user) — change it via "use a different email".
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="inline-email-locked">
              <FormattedMessage id="portal.auth.email.label" defaultMessage="Email" />
            </Label>
            {showBack && <BackToEmailLink onClick={backToEmail} />}
          </div>
          <Input
            id="inline-email-locked"
            type="email"
            value={email}
            readOnly
            className="bg-muted/40"
          />
        </div>
      )}

      {/* Password credentials form */}
      {step === 'credentials' && passwordEnabled && (
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {error && <FormError message={error} />}

          {mode === 'signup' && (
            <div className="space-y-2">
              <Label htmlFor="inline-name">
                <FormattedMessage id="portal.auth.name.label" defaultMessage="Name" />
              </Label>
              <Input
                id="inline-name"
                type="text"
                placeholder={intl.formatMessage({
                  id: 'portal.auth.name.placeholder',
                  defaultMessage: 'Jane Doe',
                })}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loadingAction !== null}
                autoComplete="name"
              />
            </div>
          )}

          {/* Hidden username (the email) pairs with the password field below so
              password managers — and the browser's a11y form heuristics — treat
              this as a proper sign-in form. */}
          <input type="hidden" name="email" value={email} autoComplete="username" readOnly />

          <div className="space-y-2">
            <Label htmlFor="inline-password">
              <FormattedMessage id="portal.auth.password.label" defaultMessage="Password" />
            </Label>
            <Input
              id="inline-password"
              type="password"
              placeholder={
                mode === 'signup'
                  ? intl.formatMessage({
                      id: 'portal.auth.password.placeholderSignup',
                      defaultMessage: 'At least 8 characters',
                    })
                  : '••••••••'
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loadingAction !== null}
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
                <FormattedMessage
                  id="portal.auth.forgotPassword"
                  defaultMessage="Forgot password?"
                />
              </button>
            </div>
          )}

          <Button type="submit" disabled={loadingAction !== null} className="w-full">
            {loadingAction === 'password' && (
              <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
            )}
            {loadingAction === 'password' ? (
              mode === 'signup' ? (
                <FormattedMessage
                  id="portal.auth.creatingAccount"
                  defaultMessage="Creating account..."
                />
              ) : (
                <FormattedMessage id="portal.auth.signingIn" defaultMessage="Signing in..." />
              )
            ) : mode === 'signup' ? (
              <FormattedMessage id="portal.auth.createAccount" defaultMessage="Create account" />
            ) : (
              <FormattedMessage id="portal.auth.signIn" defaultMessage="Sign in" />
            )}
          </Button>

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
                <FormattedMessage
                  id="portal.auth.emailLinkInstead"
                  defaultMessage="Email me a sign-in link instead"
                />
              </button>
            </div>
          )}
        </form>
      )}

      {/* Magic-link send (password disabled OR user clicked "email me a link") */}
      {step === 'email' && magicLinkEnabled && (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          {error && <FormError message={error} />}

          <input type="hidden" name="email" value={email} autoComplete="email" readOnly />

          <Button type="submit" disabled={loadingAction !== null} className="w-full">
            {loadingAction === 'email' ? (
              <>
                <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                <FormattedMessage id="portal.auth.sendingEmail" defaultMessage="Sending email…" />
              </>
            ) : (
              <FormattedMessage
                id="portal.auth.continueWithEmail"
                defaultMessage="Continue with email"
              />
            )}
          </Button>

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
                <FormattedMessage
                  id="portal.auth.usePasswordInstead"
                  defaultMessage="Use password instead"
                />
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
            <FormattedMessage id="portal.auth.back" defaultMessage="Back" />
          </button>

          <div className="text-center">
            <h2 className="text-lg font-semibold">
              <FormattedMessage
                id="portal.auth.forgot.title"
                defaultMessage="Reset your password"
              />
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <FormattedMessage
                id="portal.auth.forgot.description"
                defaultMessage="Enter your email and we'll send you a link to reset your password."
              />
            </p>
          </div>

          {error && <FormError message={error} />}

          <div className="space-y-2">
            <Label htmlFor="inline-forgot-email">
              <FormattedMessage id="portal.auth.email.label" defaultMessage="Email" />
            </Label>
            <Input
              id="inline-forgot-email"
              type="email"
              placeholder={intl.formatMessage({
                id: 'portal.auth.email.placeholder',
                defaultMessage: 'you@example.com',
              })}
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
                <FormattedMessage
                  id="portal.auth.forgot.sending"
                  defaultMessage="Sending link..."
                />
              </>
            ) : (
              <FormattedMessage id="portal.auth.forgot.send" defaultMessage="Send reset link" />
            )}
          </Button>
        </form>
      )}

      {step === 'reset' && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={backToMethods}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="mr-1 h-4 w-4" />
            <FormattedMessage id="portal.auth.back" defaultMessage="Back" />
          </button>

          <div className="text-center space-y-3">
            <EnvelopeIcon className="h-10 w-10 text-primary mx-auto" />
            <h2 className="text-lg font-semibold">
              <FormattedMessage id="portal.auth.reset.title" defaultMessage="Check your email" />
            </h2>
            <p className="text-sm text-muted-foreground">
              <FormattedMessage
                id="portal.auth.reset.description"
                defaultMessage="We sent a password reset link to {email}. The link expires in 24 hours."
                values={{ email: <span className="font-medium text-foreground">{email}</span> }}
              />
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
      <FormattedMessage id="portal.auth.useDifferentEmail" defaultMessage="Use a different email" />
    </button>
  )
}
