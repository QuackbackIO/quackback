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
  | '/onboarding/complete'
  | '/onboarding/workspace'

export function pickOnboardingStep({ session, state }: PickStepInput): OnboardingStep {
  if (!session?.userId) return '/onboarding/account'
  if (!state) return '/onboarding/workspace'

  if (state.needsInvitation) return '/auth/login'

  // Route to the FIRST incomplete step in wizard order. Whatever the
  // orchestrator (or self-hosted operator) hasn't already stamped on
  // setupState becomes the user's next click. Earlier revisions
  // jumped straight to /onboarding/boards as soon as steps.workspace
  // was true, but that left useCase silently false-checkmarked when
  // an external pre-seed populated workspace without picking a use
  // case.
  if (!state.setupState?.useCase || !state.setupState.steps.workspace) {
    return '/onboarding/workspace'
  }
  if (!state.setupState.steps.startingPoint) return '/onboarding/boards'
  if (!state.setupState.activationHandoffSeenAt) return '/onboarding/complete'
  return '/admin'
}
