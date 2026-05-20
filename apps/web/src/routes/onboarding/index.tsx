import { createFileRoute, redirect } from '@tanstack/react-router'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { pickOnboardingStep } from './onboarding-step'

/**
 * Onboarding index route - redirects to the appropriate step.
 * This acts as a router that determines where the user should be in the onboarding flow.
 * Note: Parent layout (_layout.tsx) handles redirecting when setup is already complete.
 */
export const Route = createFileRoute('/onboarding/')({
  loader: async ({ context }) => {
    const { session } = context

    if (!session?.user) {
      throw redirect({ to: '/onboarding/account' })
    }

    const state = await checkOnboardingState({ data: session.user.id })
    const target = pickOnboardingStep({
      session: { userId: session.user.id },
      state: {
        needsInvitation: state.needsInvitation,
        setupState: state.setupState,
        principalRecord: state.principalRecord,
      },
    })
    throw redirect({ to: target })
  },
  component: () => null,
})
