import { useEffect, useState } from 'react'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PortalAuthFormInline } from '@/components/auth/portal-auth-form-inline'
import {
  OnboardingHeading,
  OnboardingLead,
  OnboardingPreviewPanel,
  OnboardingSplit,
  useBrowserHost,
} from '@/components/onboarding/onboarding-split'
import { PortalPreview } from '@/components/onboarding/portal-preview'
import { SetupSteps } from '@/components/onboarding/setup-steps'
import { authClient } from '@/lib/client/auth-client'
import { postAuthSuccess, useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { startOidcSignIn } from '@/lib/client/start-oidc-sign-in'
import type { WorkspaceClaim } from '@/lib/server/functions/onboarding'
import type { AccountAuthConfig } from './-account-auth-config'
import { track } from '@/lib/client/analytics'

export interface AccountStepProps {
  ssoEnabled: boolean
  claim: WorkspaceClaim
  authConfig: AccountAuthConfig
  workspaceName?: string
}

/** Onboarding is where every sign-in lands back, so the emailed link and
 *  the OAuth callback both return to the wizard router, which forwards to
 *  whichever step the arriving user actually needs. */
const ONBOARDING_CALLBACK = '/onboarding'

/**
 * Answers the sign-in success broadcast by sending the wizard to its router.
 *
 * `PortalAuthFormInline` ends every success path — password, one-time code,
 * and the OAuth popup's callback page — with `postAuthSuccess()`, a message
 * for whichever host is showing the form. The portal's dialog answers it by
 * closing and refreshing; here the answer is to re-read the session and let
 * `/onboarding` route the newly signed-in user to the step they belong on.
 *
 * The router context is refreshed FIRST: `/onboarding` decides on the session
 * it can see, and a stale one sends the user straight back to this screen.
 */
function useAdvanceOnAuthSuccess(
  event: 'onboarding_account_created' | 'onboarding_signed_in'
): void {
  const router = useRouter()
  const navigate = useNavigate()

  useAuthBroadcast({
    onSuccess: () => {
      void track(event)
      void (async () => {
        await router.invalidate()
        await navigate({ to: ONBOARDING_CALLBACK })
      })()
    },
  })
}

/**
 * The account screens' frame: the setup split, with the whole portal in the
 * panel so someone new to Quackback sees what customers will get before they
 * have set anything up.
 */
function AccountFrame({
  children,
  workspaceName,
}: {
  children: React.ReactNode
  workspaceName?: string
}) {
  const intl = useIntl()
  const host = useBrowserHost()
  return (
    <OnboardingSplit
      panel={
        <OnboardingPreviewPanel
          caption={
            <FormattedMessage
              id="onboarding.account.previewCaption"
              defaultMessage="Your portal: where customers share ideas, vote and follow what you ship."
            />
          }
        >
          <PortalPreview
            variant="overview"
            name={
              workspaceName ||
              intl.formatMessage({
                id: 'onboarding.preview.placeholderName',
                defaultMessage: 'Your workspace',
              })
            }
            hostname={host}
          />
        </OnboardingPreviewPanel>
      }
    >
      {children}
    </OnboardingSplit>
  )
}

/** The lighter heading the sign-in screens use: their titles are sentences. */
const SENTENCE_HEADING = 'text-[30px] leading-[1.12] tracking-[-0.02em] sm:text-[34px]'

/**
 * Which first screen this workspace has earned.
 *
 * SSO wins outright: where an operator baked in an identity provider, it is
 * the only legitimate path to admin. Otherwise three facts decide, all read
 * from the workspace itself: whether setup is already owned, whether arriving
 * here is still a way to take it, and whether the workspace accepts passwords.
 * An install that nobody has claimed and that accepts passwords gets the
 * one-step admin form.
 *
 * The middle fact is why this screen cannot decide on `claimed` alone. A
 * workspace a control plane created for a customer has an owner before anyone
 * signs in, so it reads unclaimed while being nobody here's to claim; offering
 * account creation there would offer a path the server refuses.
 */
export function AccountStep({ ssoEnabled, claim, authConfig, workspaceName }: AccountStepProps) {
  // Every sign-in this screen offers ends by broadcasting success, and the
  // broadcast only does anything if something is listening: the OAuth tiles
  // complete in a popup that closes itself, and the code step completes in
  // this window with nothing to navigate it. Without this the sign-in worked
  // and the wizard just sat there.
  // Only the first-user form creates an account; the others sign an existing
  // owner in, which a conversion funnel must not count as a sign-up.
  const signInOnly = ssoEnabled || claim.claimed || !claim.openToClaim
  useAdvanceOnAuthSuccess(signInOnly ? 'onboarding_signed_in' : 'onboarding_account_created')

  if (ssoEnabled) return <SsoStep />
  if (claim.claimed || !claim.openToClaim) {
    return (
      <SignInOnlyStep
        reason={
          claim.claimed
            ? 'claimed'
            : claim.closedReason === 'setupComplete'
              ? 'setupComplete'
              : 'notOpen'
        }
        claim={claim}
        authConfig={authConfig}
        workspaceName={workspaceName}
      />
    )
  }
  if (authConfig.oauth.password !== false) return <FirstAdminStep />
  return <MethodsStep authConfig={authConfig} workspaceName={workspaceName} />
}

/**
 * Setup is not this visitor's to start: either an admin already owns it, or the
 * workspace was created for somebody whose account is not here yet. The owner
 * signs in and the wizard forwards them past account creation to the workspace
 * step; anyone else learns why this form is not theirs to fill in.
 *
 * Who the owner is stays unsaid. Naming them, even partially, publishes the
 * owner's initial and their whole corporate domain to every unauthenticated
 * visitor of a guessable hostname, at the moment that person is expecting
 * setup mail. Someone who is not the owner does not need the address; they
 * need to know the form is not theirs, which the copy says outright.
 *
 * A finished workspace with no admin left is a third situation: nobody is
 * waiting to set it up, so it asks for an admin account and offers nothing to
 * create.
 *
 * The reasons get different copy because they are different situations to
 * be in, and telling a customer waiting on a workspace they just paid for that
 * it "already has an owner" would send them to support for no reason.
 */
function SignInOnlyStep({
  reason,
  claim,
  authConfig,
  workspaceName,
}: {
  reason: 'claimed' | 'notOpen' | 'setupComplete'
  claim: WorkspaceClaim
  authConfig: AccountAuthConfig
  workspaceName?: string
}) {
  return (
    <AccountFrame workspaceName={workspaceName}>
      <div className="mb-8">
        <OnboardingHeading className={SENTENCE_HEADING}>
          {reason === 'claimed' ? (
            <FormattedMessage
              id="onboarding.account.claimed.title"
              defaultMessage="This workspace already has an owner"
            />
          ) : reason === 'setupComplete' ? (
            <FormattedMessage
              id="onboarding.account.setupComplete.title"
              defaultMessage="This workspace is already set up"
            />
          ) : (
            <FormattedMessage
              id="onboarding.account.notOpen.title"
              defaultMessage="Sign in to set up this workspace"
            />
          )}
        </OnboardingHeading>
        <OnboardingLead>
          {reason === 'claimed' ? (
            <FormattedMessage
              id="onboarding.account.claimed.signIn"
              defaultMessage="Setup belongs to an existing admin. Sign in as that admin to pick up where setup left off."
            />
          ) : reason === 'setupComplete' ? (
            <FormattedMessage
              id="onboarding.account.setupComplete.signIn"
              defaultMessage="Sign in with an admin account."
            />
          ) : (
            <FormattedMessage
              id="onboarding.account.notOpen.signIn"
              defaultMessage="This workspace was created for a specific account. Sign in with that account to set it up."
            />
          )}
        </OnboardingLead>
      </div>

      {/* The one component that already renders exactly the methods a
          workspace allows. Login mode: the owner has an account here
          already, and nobody else is meant to create one on this screen. */}
      <PortalAuthFormInline
        mode="login"
        authConfig={authConfig}
        workspaceName={workspaceName}
        callbackUrl={ONBOARDING_CALLBACK}
      />

      <p className="mt-6 text-sm text-muted-foreground">
        <FormattedMessage
          id="onboarding.account.claimed.notOwner"
          defaultMessage="Not the admin? Ask them to invite you, then sign in with the account they invite."
        />{' '}
        {claim.setupComplete && (
          <Link to="/" className="font-medium text-foreground hover:underline underline-offset-4">
            <FormattedMessage
              id="onboarding.account.claimed.requestAccess"
              defaultMessage="Request access"
            />
          </Link>
        )}
      </p>
    </AccountFrame>
  )
}

/** Password rule the server enforces, checked here so the form can say so first. */
const MIN_PASSWORD_LENGTH = 8

/**
 * A fresh install, nobody owns setup yet: the first account created here
 * becomes the admin, in one form.
 *
 * There is no email-first stage: it exists to route an address that already
 * has an account, and nobody has one yet. No social or OIDC tiles either:
 * before setup no provider has credentials this workspace can vouch for, so a
 * tile here would be a button that fails. Providers configured later appear on
 * the sign-in page as usual.
 *
 * The name is required because it is what customers see on replies and
 * updates; without one, the account shows its address's local part instead.
 */
function FirstAdminStep() {
  const intl = useIntl()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [invalidField, setInvalidField] = useState<'name' | 'email' | 'password' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /** Point at the field to fix: mark it invalid and move focus to it. */
  function refuse(field: 'name' | 'email' | 'password', message: string) {
    setInvalidField(field)
    setError(message)
    document.getElementById(`admin-${field}`)?.focus()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    if (!trimmedName) {
      refuse(
        'name',
        intl.formatMessage({
          id: 'onboarding.account.error.name',
          defaultMessage: 'Enter your name. Customers see it on your replies and updates.',
        })
      )
      return
    }
    if (!/^[^\s@]+@[^\s@]+$/.test(trimmedEmail)) {
      refuse(
        'email',
        intl.formatMessage({
          id: 'onboarding.account.error.email',
          defaultMessage: 'Enter a valid email address.',
        })
      )
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      refuse(
        'password',
        intl.formatMessage({
          id: 'onboarding.account.error.password',
          defaultMessage: 'Use a password of at least 8 characters.',
        })
      )
      return
    }
    setError('')
    setInvalidField(null)
    setSubmitting(true)
    try {
      const result = await authClient.signUp.email({
        name: trimmedName,
        email: trimmedEmail,
        password,
      })
      if (result.error) {
        throw new Error(
          result.error.message ||
            intl.formatMessage({
              id: 'onboarding.account.error.create',
              defaultMessage: 'We could not create your account. Try again.',
            })
        )
      }
      // The same broadcast every other sign-in path ends with, so the one
      // listener in AccountStep advances the wizard.
      postAuthSuccess()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'onboarding.account.error.create',
              defaultMessage: 'We could not create your account. Try again.',
            })
      )
      setSubmitting(false)
    }
  }

  return (
    <AccountFrame>
      <SetupSteps current="account" />
      <div className="mt-8">
        <OnboardingHeading>
          <FormattedMessage
            id="onboarding.account.firstAdmin.title"
            defaultMessage="Welcome to {br}Quackback"
            values={{ br: <br /> }}
          />
        </OnboardingHeading>
        <OnboardingLead>
          <FormattedMessage
            id="onboarding.account.firstAdmin.lead"
            defaultMessage="Start with your admin account. You’ll use it to sign in, invite your team and change any setting."
          />
        </OnboardingLead>
      </div>

      <form onSubmit={submit} noValidate className="mt-8 flex max-w-[440px] flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="admin-name" className="text-sm font-medium">
            <FormattedMessage id="onboarding.account.field.name" defaultMessage="Name" />
          </label>
          <Input
            id="admin-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Jane Doe"
            autoComplete="name"
            autoFocus
            aria-invalid={invalidField === 'name' || undefined}
            disabled={submitting}
            className="h-12 rounded-xl px-4 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="admin-email" className="text-sm font-medium">
            <FormattedMessage id="onboarding.account.field.email" defaultMessage="Email" />
          </label>
          <Input
            id="admin-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            aria-invalid={invalidField === 'email' || undefined}
            disabled={submitting}
            className="h-12 rounded-xl px-4 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="admin-password" className="text-sm font-medium">
            <FormattedMessage id="onboarding.account.field.password" defaultMessage="Password" />
          </label>
          <div className="relative">
            <Input
              id="admin-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              aria-invalid={invalidField === 'password' || undefined}
              aria-describedby="admin-password-hint"
              disabled={submitting}
              className="h-12 rounded-xl px-4 pe-12 text-base"
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-pressed={showPassword}
              aria-label={intl.formatMessage(
                showPassword
                  ? { id: 'onboarding.account.hidePassword', defaultMessage: 'Hide password' }
                  : { id: 'onboarding.account.showPassword', defaultMessage: 'Show password' }
              )}
              className="absolute inset-y-0 end-0 grid w-12 place-items-center rounded-e-xl text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {showPassword ? (
                <EyeSlashIcon className="size-5" aria-hidden="true" />
              ) : (
                <EyeIcon className="size-5" aria-hidden="true" />
              )}
            </button>
          </div>
          <p id="admin-password-hint" className="text-xs text-muted-foreground">
            <FormattedMessage
              id="onboarding.account.passwordHint"
              defaultMessage="At least 8 characters."
            />
          </p>
        </div>

        <div aria-live="polite" aria-atomic="true">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>

        <Button type="submit" disabled={submitting} className="h-12 w-full rounded-full text-base">
          {submitting ? (
            <>
              <ArrowPathIcon className="size-4 animate-spin motion-reduce:animate-none" />
              <FormattedMessage
                id="onboarding.account.creating"
                defaultMessage="Creating account…"
              />
            </>
          ) : (
            <FormattedMessage id="onboarding.account.create" defaultMessage="Create account" />
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          <FormattedMessage
            id="onboarding.account.firstAdmin.reassure"
            defaultMessage="Setup takes about a minute. You can change everything later in Settings."
          />
        </p>
      </form>
    </AccountFrame>
  )
}

/**
 * Nobody owns setup yet, but this workspace does not accept passwords, so the
 * first admin arrives by an emailed link instead.
 *
 * Only the workspace's email methods are offered. Social and OIDC tiles are
 * left out for the same reason as on the password form.
 */
function MethodsStep({
  authConfig,
  workspaceName,
}: {
  authConfig: AccountAuthConfig
  workspaceName?: string
}) {
  return (
    <AccountFrame workspaceName={workspaceName}>
      <SetupSteps current="account" />
      <div className="mt-8 mb-8">
        <OnboardingHeading>
          <FormattedMessage
            id="onboarding.account.firstAdmin.title"
            defaultMessage="Welcome to {br}Quackback"
            values={{ br: <br /> }}
          />
        </OnboardingHeading>
        <OnboardingLead>
          <FormattedMessage
            id="onboarding.account.methodsDescription"
            defaultMessage="Create your admin account to set up this workspace."
          />
        </OnboardingLead>
      </div>
      <div className="max-w-[440px]">
        <PortalAuthFormInline
          // Nobody has an account on this workspace yet, so the form says "Sign
          // up", not "Sign in". `openSignup` is forced on because the server
          // does the same thing here and for the same reason: it governs who
          // may open a PORTAL account, and refusing the very first arrival on a
          // workspace still open to be claimed would leave one nobody can ever
          // set up. This screen is only reached when it IS still open.
          mode="signup"
          authConfig={{
            ...authConfig,
            oauth: { password: authConfig.oauth.password, magicLink: authConfig.oauth.magicLink },
            oidcProviders: undefined,
            openSignup: true,
          }}
          workspaceName={workspaceName}
          callbackUrl={ONBOARDING_CALLBACK}
        />
      </div>
    </AccountFrame>
  )
}

function SsoStep() {
  const intl = useIntl()
  const [error, setError] = useState('')
  const [ssoRedirecting, setSsoRedirecting] = useState(false)

  async function startSso() {
    setSsoRedirecting(true)
    setError('')
    try {
      const result = await startOidcSignIn({
        providerId: 'sso',
        callbackURL: ONBOARDING_CALLBACK,
      })
      if (result.error) {
        throw new Error(
          result.error.message ||
            intl.formatMessage({
              id: 'onboarding.account.ssoError',
              defaultMessage: 'We couldn’t start single sign-on. Try again.',
            })
        )
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'onboarding.account.ssoError',
              defaultMessage: 'We couldn’t start single sign-on. Try again.',
            })
      )
      setSsoRedirecting(false)
    }
  }

  // Auto-trigger the redirect on mount: the click adds nothing when this is
  // the only path on offer. If the kick-off fails the button below stays
  // interactable as a manual retry.
  useEffect(() => {
    void startSso()
  }, [])

  return (
    <AccountFrame>
      <OnboardingHeading>
        <FormattedMessage
          id="onboarding.account.firstAdmin.title"
          defaultMessage="Welcome to {br}Quackback"
          values={{ br: <br /> }}
        />
      </OnboardingHeading>
      <OnboardingLead>
        <FormattedMessage
          id="onboarding.account.ssoDescription"
          defaultMessage="Continue with your company account."
        />
      </OnboardingLead>
      <div aria-live="polite" aria-atomic="true">
        {ssoRedirecting && !error && (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            <FormattedMessage
              id="onboarding.account.redirecting"
              defaultMessage="Taking you to your identity provider…"
            />
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="mt-4 max-w-[440px] rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}
      </div>
      <Button
        onClick={() => void startSso()}
        disabled={ssoRedirecting}
        className="mt-8 h-12 w-full max-w-[440px] rounded-full text-base"
      >
        {ssoRedirecting ? (
          <FormattedMessage
            id="onboarding.account.redirectingShort"
            defaultMessage="Redirecting…"
          />
        ) : error ? (
          <FormattedMessage id="onboarding.account.ssoRetry" defaultMessage="Try SSO again" />
        ) : (
          <FormattedMessage
            id="onboarding.account.ssoContinue"
            defaultMessage="Continue with SSO"
          />
        )}
      </Button>
    </AccountFrame>
  )
}
