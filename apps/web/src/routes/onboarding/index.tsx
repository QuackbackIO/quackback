import { createFileRoute, redirect } from '@tanstack/react-router'
import { checkOnboardingState } from '@/lib/server-functions/admin'

/**
 * Onboarding index route - redirects to the appropriate step.
 * This acts as a router that determines where the user should be in the onboarding flow.
 * Note: Parent layout (_layout.tsx) handles redirecting when setup is already complete.
 */
export const Route = createFileRoute('/onboarding/')({
  loader: async ({ context }) => {
    const { session } = context

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
