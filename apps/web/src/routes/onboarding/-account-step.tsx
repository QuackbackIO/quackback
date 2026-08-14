import { useEffect, useState } from 'react'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { PortalAuthFormInline } from '@/components/auth/portal-auth-form-inline'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { authClient } from '@/lib/client/auth-client'
import type { WorkspaceClaim } from '@/lib/server/functions/onboarding'

/** Sign-in methods the workspace actually allows, in the shape
 *  `PortalAuthFormInline` already consumes on the portal. */
interface AccountAuthConfig {
  found: boolean
  oauth: Record<string, boolean | undefined>
  openSignup?: boolean
  oidcProviders?: { id: string; name: string }[]
  registeredAuthProviders?: string[]
  twoFactorRequired?: boolean
}

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
function useAdvanceOnAuthSuccess(): void {
  const router = useRouter()
  const navigate = useNavigate()

  useAuthBroadcast({
    onSuccess: () => {
      void (async () => {
        await router.invalidate()
        await navigate({ to: ONBOARDING_CALLBACK })
      })()
    },
  })
}

function StepCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="p-8">{children}</div>
      </div>
    </div>
  )
}

/**
 * Which first screen this workspace has earned.
 *
 * SSO wins outright: where an operator baked in an identity provider, it is
 * the only legitimate path to admin. Otherwise three facts decide, all read
 * from the workspace itself: whether setup is already owned, whether arriving
 * here is still a way to take it, and whether the workspace accepts passwords.
 * An install that nobody has claimed and that accepts passwords keeps the
 * account-creation form unchanged.
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
  useAdvanceOnAuthSuccess()

  if (ssoEnabled) return <SsoStep />
  if (claim.claimed || !claim.openToClaim) {
    return (
      <SignInOnlyStep
        reason={claim.claimed ? 'claimed' : 'notOpen'}
        claim={claim}
        authConfig={authConfig}
        workspaceName={workspaceName}
      />
    )
  }
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
 * The two reasons get different copy because they are different situations to
 * be in, and telling a customer waiting on a workspace they just paid for that
 * it "already has an owner" would send them to support for no reason.
 */
function SignInOnlyStep({
  reason,
  claim,
  authConfig,
  workspaceName,
}: {
  reason: 'claimed' | 'notOpen'
  claim: WorkspaceClaim
  authConfig: AccountAuthConfig
  workspaceName?: string
}) {
  return (
    <StepCard>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold">
          {reason === 'claimed' ? (
            <FormattedMessage
              id="onboarding.account.claimed.title"
              defaultMessage="This workspace already has an owner"
            />
          ) : (
            <FormattedMessage
              id="onboarding.account.notOpen.title"
              defaultMessage="Sign in to set up this workspace"
            />
          )}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {reason === 'claimed' ? (
            <FormattedMessage
              id="onboarding.account.claimed.signIn"
              defaultMessage="Setup belongs to an existing admin. Sign in as that admin to pick up where setup left off."
            />
          ) : (
            <FormattedMessage
              id="onboarding.account.notOpen.signIn"
              defaultMessage="This workspace was created for a specific account. Sign in with that account to set it up."
            />
          )}
        </p>
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

      <p className="mt-6 text-center text-sm text-muted-foreground">
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
    </StepCard>
  )
}

/**
 * Nobody owns setup yet, but the workspace does not accept passwords, so
 * the first user arrives through whichever method it does accept. Magic
 * link and social sign-in both create the account on first use, and the
 * wizard promotes that first user to admin exactly as before.
 */
function MethodsStep({
  authConfig,
  workspaceName,
}: {
  authConfig: AccountAuthConfig
  workspaceName?: string
}) {
  return (
    <StepCard>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold">
          <FormattedMessage id="onboarding.account.title" defaultMessage="Welcome to Quackback" />
        </h1>
        <p className="mt-2 text-muted-foreground">
          <FormattedMessage
            id="onboarding.account.methodsDescription"
            defaultMessage="Continue with one of your workspace's sign-in methods to set it up."
          />
        </p>
      </div>
      <PortalAuthFormInline
        // Nobody has an account on this workspace yet, so the tiles say "Sign
        // up with", not "Sign in with". `openSignup` is forced on because the
        // server does the same thing here and for the same reason: it governs
        // who may open a PORTAL account, and refusing the very first arrival on
        // a workspace still open to be claimed would leave one nobody can ever
        // set up. This screen is only reached when it IS still open.
        mode="signup"
        authConfig={{ ...authConfig, openSignup: true }}
        workspaceName={workspaceName}
        callbackUrl={ONBOARDING_CALLBACK}
      />
    </StepCard>
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
      const result = await authClient.signIn.oauth2({
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
    <div className="w-full max-w-md mx-auto">
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="p-8 text-center">
          <h1 className="text-2xl font-bold">
            <FormattedMessage id="onboarding.account.title" defaultMessage="Welcome to Quackback" />
          </h1>
          <p className="mt-2 text-muted-foreground">
            <FormattedMessage
              id="onboarding.account.ssoDescription"
              defaultMessage="Continue with your company account."
            />
          </p>
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
                className="mt-4 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}
          </div>
          <Button
            onClick={() => void startSso()}
            disabled={ssoRedirecting}
            className="mt-6 w-full h-11"
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
        </div>
      </div>
    </div>
  )
}
