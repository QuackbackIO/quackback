import { createFileRoute, redirect } from '@tanstack/react-router'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { pickOnboardingStep } from './-onboarding-step'

/**
 * The old "Quick start" step is gone. Creating a board (or Messenger,
 * article, …) now lives on the use-case launch list. Keep this path so
 * bookmarks and mid-wizard tabs still land somewhere real.
 */
export const Route = createFileRoute('/onboarding/_layout/boards')({
  loader: async ({ context }) => {
    if (!context.session?.user) throw redirect({ to: '/onboarding/account' })
    const state = await checkOnboardingState()
    throw redirect({
      to: pickOnboardingStep({ session: { userId: context.session.user.id }, state }),
    })
  },
  component: () => null,
})
