import { createFileRoute, redirect } from '@tanstack/react-router'
import { checkOnboardingState } from '@/lib/server-functions/admin'
import { getSetupState, isOnboardingComplete } from '@quackback/db/types'

/**
 * Onboarding index route - redirects to the appropriate step.
 * This acts as a router that determines where the user should be in the onboarding flow.
 */
export const Route = createFileRoute('/onboarding/')({
  loader: async ({ context }) => {
    const { session, settingsData } = context

    // Check setup state from settings
    const setupState = getSetupState(settingsData?.settings?.setupState ?? null)

    // If onboarding is complete, go to admin
    if (isOnboardingComplete(setupState)) {
      throw redirect({ to: '/admin' })
    }

    // Not authenticated - start with account creation
    if (!session?.user) {
      throw redirect({ to: '/onboarding/account' })
    }

    // Authenticated - check onboarding state
    const state = await checkOnboardingState({ data: session.user.id })

    if (state.needsInvitation) {
      // Not first user - they need an invitation
      throw redirect({ to: '/auth/login' })
    }

    if (state.isOnboardingComplete) {
      throw redirect({ to: '/admin' })
    }

    // Determine which step to go to
    if (state.setupState?.steps?.workspace) {
      // Workspace done, go to boards
      throw redirect({ to: '/onboarding/boards' })
    }

    // Need to setup workspace
    throw redirect({ to: '/onboarding/workspace' })
  },
  component: () => null, // This route only redirects
})
