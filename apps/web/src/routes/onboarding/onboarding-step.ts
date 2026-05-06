import type { SetupState } from '@/lib/shared/db-types'

interface OnboardingStateInput {
  needsInvitation?: boolean
  setupState: SetupState | null
  principalRecord: { id: string; role: string } | null
}

interface PickStepInput {
  session: { userId: string } | null
  state: OnboardingStateInput | null
}

/** Step targets the onboarding flow can route to. Pure string union so
 *  the loader can swap between server-fn redirects and tests can assert. */
export type OnboardingStep =
  | '/admin'
  | '/auth/login'
  | '/onboarding/account'
  | '/onboarding/boards'
  | '/onboarding/usecase'
  | '/onboarding/workspace'

export function pickOnboardingStep({ session, state }: PickStepInput): OnboardingStep {
  if (!session?.userId) return '/onboarding/account'
  if (!state) return '/onboarding/usecase'

  if (state.needsInvitation) return '/auth/login'

  // Cloud-provisioned admins skip the wizard; setup_state is pre-stamped.
  if (state.setupState?.source === 'cloud' && state.principalRecord) {
    return '/admin'
  }

  if (state.setupState?.steps?.workspace) return '/onboarding/boards'
  if (state.setupState?.useCase) return '/onboarding/workspace'
  return '/onboarding/usecase'
}
