import { createFileRoute, redirect } from '@tanstack/react-router'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { ensureOnboardingHomeReadyFn } from '@/lib/server/functions/onboarding'
import { pickOnboardingStep } from './-onboarding-step'

export const Route = createFileRoute('/onboarding/_layout/usecase')({
  loader: async ({ context }) => {
    if (!context.session?.user) throw redirect({ to: '/onboarding/account' })
    const state = await checkOnboardingState()
    const target = pickOnboardingStep({
      session: { userId: context.session.user.id },
      state,
    })
    if (target === '/admin') await ensureOnboardingHomeReadyFn()
    throw redirect({ to: target === '/onboarding/usecase' ? '/admin' : target })
  },
  component: () => null,
})
