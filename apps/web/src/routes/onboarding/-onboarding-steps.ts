export type OnboardingStepDef = { path: string; label: string }

/**
 * Canonical onboarding wizard steps in the order they appear. Rendered
 * verbatim by the stepper — completed steps stay visible with a check
 * rather than being filtered out, so the user's sense of forward
 * progress (Step 2 of 4 → 3 of 4 → 4 of 4) isn't erased as they
 * advance.
 *
 * Pre-stamped tenants (config-file watcher reconciles spec.workspace /
 * useCase before first sign-in) just skip the matching loaders via
 * pickOnboardingStep, so the user lands directly on the later step and
 * the earlier ones appear as completed — accurate, not hidden.
 */
export const ALL_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  { path: '/onboarding/account', label: 'Account' },
  { path: '/onboarding/usecase', label: 'Use case' },
  { path: '/onboarding/workspace', label: 'Workspace' },
  { path: '/onboarding/boards', label: 'Boards' },
] as const
