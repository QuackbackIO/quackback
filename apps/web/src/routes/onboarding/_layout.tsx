import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import {
  getSetupState,
  isOnboardingComplete,
  needsCloudOnboardingWizard,
} from '@/lib/shared/db-types'
import { mayForwardCompletedSetup } from './-onboarding-step'

/**
 * Shared layout for all onboarding steps. Sends an admin whose setup is
 * already complete on to /admin. The ready step needs no exception: it shows
 * in place on the workspace route, after that route has loaded.
 */
export const Route = createFileRoute('/onboarding/_layout')({
  beforeLoad: ({ context, location }) => {
    // A pre-stamped workspace still needs an authenticated owner. Redirecting
    // an anonymous visitor to the handoff would bounce between that route and
    // the account step forever.
    if (!context.session?.user) return
    if (!mayForwardCompletedSetup({ pathname: location.pathname, userRole: context.userRole })) {
      return
    }
    const setupState = getSetupState(context.settings?.settings?.setupState ?? null)
    if (isOnboardingComplete(setupState) && !needsCloudOnboardingWizard(setupState)) {
      throw redirect({ to: '/admin' })
    }
  },
  component: OnboardingLayout,
})

/**
 * Each step draws the full-page setup split itself, because the preview panel
 * on its right belongs to the step: the whole portal on the account screens,
 * the portal as it is being named on the workspace step. Steps a signed-in
 * visitor can reach carry the sign-out control in their footer.
 */
function OnboardingLayout() {
  return <Outlet />
}
