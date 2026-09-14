import { createFileRoute, redirect } from '@tanstack/react-router'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { ensureOnboardingHomeReadyFn } from '@/lib/server/functions/onboarding'
import { pickOnboardingStep } from './-onboarding-step'

export const Route = createFileRoute('/onboarding/_layout/complete')({
  loader: async ({ context }) => {
    if (!context.session?.user) throw redirect({ to: '/onboarding/account' })
    const state = await checkOnboardingState()
    const target = pickOnboardingStep({ session: { userId: context.session.user.id }, state })
    if (target === '/admin' || target === '/onboarding/complete') {
      await ensureOnboardingHomeReadyFn()
      throw redirect({ to: '/admin' })
    }
    throw redirect({ to: target })
  },
  component: () => null,
})
