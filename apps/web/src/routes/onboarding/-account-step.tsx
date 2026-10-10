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
  SETUP_AUTH_FORM_CLASS,
  SETUP_CTA_CLASS,
  SETUP_FIELD_CLASS,
  useBrowserHost,
  useSetupTitle,
} from '@/components/onboarding/onboarding-split'
import { PortalPreview } from '@/components/onboarding/portal-preview'
import { SetupSteps } from '@/components/onboarding/setup-steps'
import { authClient } from '@/lib/client/auth-client'
import { postAuthSuccess, useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { startOidcSignIn } from '@/lib/client/start-oidc-sign-in'
import type { WorkspaceClaim } from '@/lib/server/functions/onboarding'
import type { AccountAuthConfig } from './-account-auth-config'
import { cn } from '@/lib/shared/utils'
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
  purpose = 'signIn',
}: {
  children: React.ReactNode
  workspaceName?: string
  /** What the screen is for, which names the browser tab. */
  purpose?: 'create' | 'signIn'
}) {
  const intl = useIntl()
  const host = useBrowserHost()
  useSetupTitle(
    intl.formatMessage(
      purpose === 'create'
        ? { id: 'onboarding.title.account', defaultMessage: 'Create your account · Quackback' }
        : { id: 'onboarding.title.signIn', defaultMessage: 'Sign in · Quackback' }
    )
  )
  return (
    <OnboardingSplit
      panel={
        <OnboardingPreviewPanel
          caption={
            <FormattedMessage
              id="onboarding.account.previewCaption"
              defaultMessage="An example of your portal, where customers share ideas, vote and follow what you ship."
            />
          }
        >
          <PortalPreview variant="example" name={workspaceName ?? ''} hostname={host} />
        </OnboardingPreviewPanel>
      }
    >
      {children}
    </OnboardingSplit>
  )
}

/** The lighter heading the sign-in screens use: their titles are sentences. */
const SENTENCE_HEADING = 'text-[30px] leading-[1.12] tracking-[-0.02em]! sm:text-[34px]'

/**
 * Which first screen this workspace has earned.
 *
 * SSO wins outright: where an operator baked in an identity provider, it is
 * the only legitimate path to admin. Otherwise three facts decide, all read
 * from the workspace itself: whether setup is already owned, whether arriving
 * here is still a way to take it, and whether the workspace accepts passwords.
 * An install that nobody has claimed and that accepts passwords gets the
 * one-step admin form. Once its first account exists, that account has
 * claimed setup, and the screen asks everyone, its owner included, to sign in.
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
  // Someone who already started setup can sign back in from the first-user
  // screen, which creates nothing either.
  const [signingIn, setSigningIn] = useState(false)
  useAdvanceOnAuthSuccess(
    signInOnly || signingIn ? 'onboarding_signed_in' : 'onboarding_account_created'
  )

  if (ssoEnabled) return <SsoStep />
  if (claim.claimed && claim.openToClaim) {
    return <SetupInProgressStep authConfig={authConfig} workspaceName={workspaceName} />
  }
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
  // Before setup finishes, an account here claims it, so while the first-user
  // form shows nobody has one to sign back in with. A workspace stamped
  // complete before its owner arrived is the exception: its accounts claim
  // nothing.
  const offerSignIn = claim.setupComplete
  if (signingIn) {
    return <ReturningSignIn authConfig={authConfig} onBack={() => setSigningIn(false)} />
  }
  if (authConfig.oauth.password !== false) {
    return <FirstAdminStep offerSignIn={offerSignIn} onSignIn={() => setSigningIn(true)} />
  }
  return (
    <MethodsStep
      workspaceName={workspaceName}
      authConfig={authConfig}
      offerSignIn={offerSignIn}
      onSignIn={() => setSigningIn(true)}
    />
  )
}

/**
 * Setup has started here: an account was created, and that account owns
 * setup. Whoever created it signs back in and the wizard carries on from the
 * workspace step; anyone else is told to wait for an invitation. Who started it
 * stays unsaid, for the same reason {@link SignInOnlyStep} gives.
 *
 * The account may be one nobody here can sign in with: a test, a stray
 * visitor, or a lost password with no mail to reset it. Only the server can
 * hand setup to someone else, so the last line says who to ask.
 *
 * Signs in with every method this install can take, providers its runtime
 * registered included, since the account may be linked to one.
 */
function SetupInProgressStep({
  authConfig,
  workspaceName,
}: {
  authConfig: AccountAuthConfig
  workspaceName?: string
}) {
  return (
    <AccountFrame workspaceName={workspaceName}>
      <div className="mb-8">
        <OnboardingHeading className={SENTENCE_HEADING}>
          <FormattedMessage
            id="onboarding.account.inProgress.title"
            defaultMessage="Sign in to finish setting up"
          />
        </OnboardingHeading>
        <OnboardingLead>
          <FormattedMessage
            id="onboarding.account.inProgress.lead"
            defaultMessage="Setup has started here. Sign in with the account you created to pick up where you left off."
          />
        </OnboardingLead>
      </div>
      <div className={cn('max-w-[440px]', SETUP_AUTH_FORM_CLASS)}>
        <PortalAuthFormInline
          mode="login"
          authConfig={{ ...authConfig, oauth: authConfig.signInOAuth ?? authConfig.oauth }}
          workspaceName={workspaceName}
          callbackUrl={ONBOARDING_CALLBACK}
        />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        <FormattedMessage
          id="onboarding.account.inProgress.notOwner"
          defaultMessage="Someone else setting this up? Ask them to invite you once setup is done."
        />
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        <FormattedMessage
          id="onboarding.account.inProgress.restart"
          defaultMessage="Setup started by mistake, or can't sign in? The server's operator can restart setup."
        />
      </p>
    </AccountFrame>
  )
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
      <div className={cn('max-w-[440px]', SETUP_AUTH_FORM_CLASS)}>
        <PortalAuthFormInline
          mode="login"
          authConfig={authConfig}
          workspaceName={workspaceName}
          callbackUrl={ONBOARDING_CALLBACK}
        />
      </div>

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
type AdminField = 'name' | 'email' | 'password'
const ADMIN_FIELDS: AdminField[] = ['name', 'email', 'password']

function FirstAdminStep({ offerSignIn, onSignIn }: { offerSignIn: boolean; onSignIn: () => void }) {
  const intl = useIntl()
  const [accountExists, setAccountExists] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  /** What is wrong with each field, shown under that field. */
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AdminField, string>>>({})
  /** What the server said, which is about the form rather than one field. */
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /** Every problem with the form as typed, so they can all be shown at once. */
  function problems(): Partial<Record<AdminField, string>> {
    const found: Partial<Record<AdminField, string>> = {}
    if (!name.trim()) {
      found.name = intl.formatMessage({
        id: 'onboarding.account.error.name',
        defaultMessage: 'Enter your name. Customers see it on your replies and updates.',
      })
    }
    if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
      found.email = intl.formatMessage({
        id: 'onboarding.account.error.email',
        defaultMessage: 'Enter a valid email address.',
      })
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      found.password = intl.formatMessage({
        id: 'onboarding.account.error.password',
        defaultMessage: 'Use a password of at least 8 characters.',
      })
    }
    return found
  }

  /** Editing a field settles its own problem; the others stay until fixed. */
  function edit(field: AdminField, value: string, set: (value: string) => void) {
    set(value)
    if (fieldErrors[field]) {
      setFieldErrors(({ [field]: _settled, ...rest }) => rest)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const found = problems()
    setFieldErrors(found)
    const first = ADMIN_FIELDS.find((field) => found[field])
    if (first) {
      setError('')
      document.getElementById(`admin-${first}`)?.focus()
      return
    }
    setError('')
    setAccountExists(false)
    setSubmitting(true)
    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
      })
      if (result.error) {
        // Created here earlier, then signed out before setup finished.
        if (result.error.code?.startsWith('USER_ALREADY_EXISTS')) {
          setAccountExists(true)
          throw new Error(
            intl.formatMessage({
              id: 'onboarding.account.error.exists',
              defaultMessage:
                'There is already an account for this email. Sign in to finish setup.',
            })
          )
        }
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
    <AccountFrame purpose="create">
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
        <div data-field className="flex flex-col gap-2">
          <label htmlFor="admin-name" className="text-sm font-medium">
            <FormattedMessage id="onboarding.account.field.name" defaultMessage="Name" />
          </label>
          <Input
            id="admin-name"
            value={name}
            onChange={(event) => edit('name', event.target.value, setName)}
            placeholder="Jane Doe"
            autoComplete="name"
            autoFocus
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? 'admin-name-error' : undefined}
            disabled={submitting}
            className={SETUP_FIELD_CLASS}
          />
          <FieldError id="admin-name-error" message={fieldErrors.name} />
        </div>
        <div data-field className="flex flex-col gap-2">
          <label htmlFor="admin-email" className="text-sm font-medium">
            <FormattedMessage id="onboarding.account.field.email" defaultMessage="Email" />
          </label>
          <Input
            id="admin-email"
            type="email"
            value={email}
            onChange={(event) => edit('email', event.target.value, setEmail)}
            placeholder="you@company.com"
            autoComplete="email"
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? 'admin-email-error' : undefined}
            disabled={submitting}
            className={SETUP_FIELD_CLASS}
          />
          <FieldError id="admin-email-error" message={fieldErrors.email} />
        </div>
        <div data-field className="flex flex-col gap-2">
          <label htmlFor="admin-password" className="text-sm font-medium">
            <FormattedMessage id="onboarding.account.field.password" defaultMessage="Password" />
          </label>
          <div className="relative">
            <Input
              id="admin-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => edit('password', event.target.value, setPassword)}
              autoComplete="new-password"
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={
                fieldErrors.password ? 'admin-password-error' : 'admin-password-hint'
              }
              disabled={submitting}
              className={cn(SETUP_FIELD_CLASS, 'pe-12')}
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
          {/* The rule is said once: as a hint until it is broken, then as the error. */}
          {fieldErrors.password ? (
            <FieldError id="admin-password-error" message={fieldErrors.password} />
          ) : (
            <p id="admin-password-hint" className="text-xs text-muted-foreground">
              <FormattedMessage
                id="onboarding.account.passwordHint"
                defaultMessage="At least 8 characters."
              />
            </p>
          )}
        </div>

        <div aria-live="polite" aria-atomic="true" className="empty:hidden">
          {error ? (
            <div
              role="alert"
              data-banner
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <p>{error}</p>
              {accountExists ? (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="mt-2 font-medium text-foreground underline underline-offset-4"
                >
                  <FormattedMessage
                    id="onboarding.account.signInInstead"
                    defaultMessage="Sign in instead"
                  />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <Button
          type="submit"
          disabled={submitting}
          aria-busy={submitting || undefined}
          className={SETUP_CTA_CLASS}
        >
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
        {offerSignIn && <StartedSetupLink onClick={onSignIn} />}
      </form>
    </AccountFrame>
  )
}

/** A field's problem, directly under it and announced when it appears. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

/** The way back in for someone who already created their account here. */
function StartedSetupLink({ onClick }: { onClick: () => void }) {
  return (
    <p className="text-sm text-muted-foreground">
      <FormattedMessage
        id="onboarding.account.startedSetup"
        defaultMessage="Already started setting up?"
      />{' '}
      <button
        type="button"
        onClick={onClick}
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        <FormattedMessage id="onboarding.account.signIn" defaultMessage="Sign in" />
      </button>
    </p>
  )
}

/**
 * Someone created their account on a workspace stamped complete before its
 * owner arrived, then was signed out before finishing setup. An account there
 * claims nothing, so the wizard still offers a new one, and that form would
 * only refuse their address. They sign in with every method this install can
 * take, including a provider their account may be linked to, and the wizard
 * carries on from the workspace step.
 */
function ReturningSignIn({
  authConfig,
  onBack,
}: {
  authConfig: AccountAuthConfig
  onBack: () => void
}) {
  return (
    <AccountFrame>
      <SetupSteps current="account" />
      <div className="mt-8 mb-8">
        <OnboardingHeading>
          <FormattedMessage id="onboarding.account.returning.title" defaultMessage="Welcome back" />
        </OnboardingHeading>
        <OnboardingLead>
          <FormattedMessage
            id="onboarding.account.returning.lead"
            defaultMessage="Sign in with the account you created here to finish setting up."
          />
        </OnboardingLead>
      </div>
      <div className={cn('max-w-[440px]', SETUP_AUTH_FORM_CLASS)}>
        <PortalAuthFormInline
          mode="login"
          authConfig={{ ...authConfig, oauth: authConfig.signInOAuth ?? authConfig.oauth }}
          callbackUrl={ONBOARDING_CALLBACK}
        />
        <button
          type="button"
          onClick={onBack}
          className="mt-6 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <FormattedMessage
            id="onboarding.account.returning.back"
            defaultMessage="Create a new account instead"
          />
        </button>
      </div>
    </AccountFrame>
  )
}

/**
 * Nobody owns setup yet, but this workspace does not accept passwords, so the
 * first admin arrives by an emailed link instead.
 *
 * Social and OIDC tiles are left out while an emailed link is on offer, for the
 * same reason as on the password form. A workspace with neither email method
 * keeps its providers: they are the only way in, and a workspace that has
 * settings only lists providers whose credentials are configured.
 */
function MethodsStep({
  authConfig,
  workspaceName,
  offerSignIn,
  onSignIn,
}: {
  authConfig: AccountAuthConfig
  workspaceName?: string
  offerSignIn: boolean
  onSignIn: () => void
}) {
  return (
    <AccountFrame workspaceName={workspaceName} purpose="create">
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
      <div className={cn('max-w-[440px]', SETUP_AUTH_FORM_CLASS)}>
        <PortalAuthFormInline
          // Nobody has an account on this workspace yet, so the form says "Sign
          // up", not "Sign in". `openSignup` is forced on because the server
          // does the same thing here and for the same reason: it governs who
          // may open a PORTAL account, and refusing the very first arrival on a
          // workspace still open to be claimed would leave one nobody can ever
          // set up. This screen is only reached when it IS still open.
          mode="signup"
          authConfig={
            authConfig.oauth.magicLink
              ? {
                  ...authConfig,
                  oauth: { password: false, magicLink: true },
                  oidcProviders: undefined,
                  openSignup: true,
                }
              : { ...authConfig, openSignup: true }
          }
          workspaceName={workspaceName}
          callbackUrl={ONBOARDING_CALLBACK}
        />
        {offerSignIn && (
          <div className="mt-6">
            <StartedSetupLink onClick={onSignIn} />
          </div>
        )}
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
        aria-busy={ssoRedirecting || undefined}
        className={cn(SETUP_CTA_CLASS, 'mt-8 max-w-[440px]')}
      >
        {ssoRedirecting ? (
          <>
            <ArrowPathIcon className="size-4 animate-spin motion-reduce:animate-none" />
            <FormattedMessage
              id="onboarding.account.redirectingShort"
              defaultMessage="Redirecting…"
            />
          </>
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
