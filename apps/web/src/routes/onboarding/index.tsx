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

    // Determine which step to go to based on progress
    if (state.setupState?.steps?.workspace) {
      throw redirect({ to: '/onboarding/boards' })
    }

    if (state.setupState?.useCase) {
      throw redirect({ to: '/onboarding/workspace' })
    }

    throw redirect({ to: '/onboarding/usecase' })
  },
  component: () => null, // This route only redirects
})
