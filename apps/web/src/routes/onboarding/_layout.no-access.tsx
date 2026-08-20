import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { isSetupBlocked, pickOnboardingStep } from './-onboarding-step'
import { SignOutButton } from './-sign-out-button'

/**
 * Where a signed-in visitor who does not own this workspace's setup stops.
 *
 * Every account is created with a principal, so "has a principal" never meant
 * "may finish setup": a non-owner used to walk the whole workspace form and be
 * refused by the bootstrap guard at the end, and a visitor with no principal
 * was sent to a sign-in route that the root gate bounced straight back into the
 * wizard, forever. Both now arrive here, where the only two things they can
 * actually do are offered: sign out and come back as the owner, or wait to be
 * invited.
 */
export const Route = createFileRoute('/onboarding/_layout/no-access')({
  loader: async ({ context }) => {
    if (!context.session?.user) throw redirect({ to: '/onboarding/account' })
    const state = await checkOnboardingState()
    // Not blocked after all (they own setup, or setup is still there to take):
    // send them to the step they belong on rather than stranding them on a
    // refusal. The router decides on the same predicate, so the two cannot
    // point at each other.
    if (!isSetupBlocked(state)) {
      throw redirect({
        to: pickOnboardingStep({ session: { userId: context.session.user.id }, state }),
      })
    }
    return {
      setupComplete: state.isOnboardingComplete,
      // Which refusal this is. An owner exists and it is not you, or nobody has
      // arrived yet and it will not be you: telling a customer still waiting on
      // the workspace they paid for that it "belongs to an existing admin"
      // sends them to support for nothing.
      claimedByOther: state.setupClaimedByOther,
    }
  },
  component: NoAccessStep,
})

function NoAccessStep() {
  const { setupComplete, claimedByOther } = Route.useLoaderData()

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="p-8 text-center">
          <h1 className="text-2xl font-bold">
            {claimedByOther ? (
              <FormattedMessage
                id="onboarding.noAccess.title"
                defaultMessage="Setup belongs to an existing admin"
              />
            ) : (
              <FormattedMessage
                id="onboarding.noAccess.notOpenTitle"
                defaultMessage="This workspace is not yours to set up"
              />
            )}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {!claimedByOther ? (
              <FormattedMessage
                id="onboarding.noAccess.notOpenBody"
                defaultMessage="This workspace was created for a specific account. Sign in with that account to set it up."
              />
            ) : setupComplete ? (
              <FormattedMessage
                id="onboarding.noAccess.readyBody"
                defaultMessage="This workspace is already set up. Ask an admin to invite you, then sign in with the account they invite."
              />
            ) : (
              <FormattedMessage
                id="onboarding.noAccess.body"
                defaultMessage="An admin here is finishing setup. Ask them to invite you, then sign in with the account they invite."
              />
            )}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            <FormattedMessage
              id="onboarding.noAccess.ownerPrompt"
              defaultMessage="Signed in as the wrong account? Sign out and try the one that set this workspace up."
            />
          </p>
          <SignOutButton className="mt-6 w-full h-11" variant="default" />
          {/* Only once the workspace has pages of its own: before that the root
              gate returns the portal root to the wizard, so this link would
              land the visitor back on this card. */}
          {setupComplete && (
            <p className="mt-4 text-sm text-muted-foreground">
              <Link
                to="/"
                className="font-medium text-foreground hover:underline underline-offset-4"
              >
                <FormattedMessage
                  id="onboarding.noAccess.requestAccess"
                  defaultMessage="Go to the workspace"
                />
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
