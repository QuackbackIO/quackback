import type { SetupState } from '@/lib/shared/db-types'
import { isAdmin } from '@/lib/shared/roles'

interface OnboardingStateInput {
  /** Somebody else already owns this workspace's setup, so the wizard is not
   *  this caller's to finish. */
  setupClaimedByOther?: boolean
  /** Whether arriving here is still a way to become this workspace's admin.
   *  False on a workspace a control plane created; null when nobody asked,
   *  because there was no session to route. */
  setupOpenToClaim?: boolean | null
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
  | '/admin/getting-started'
  | '/onboarding/account'
  | '/onboarding/complete'
  | '/onboarding/no-access'
  | '/onboarding/usecase'
  | '/onboarding/workspace'

/** The one page inside the wizard that exists to be a dead end. */
const ONBOARDING_NO_ACCESS = '/onboarding/no-access'

/**
 * Whether the wizard layout may forward a caller past the steps because the
 * setup state already reads complete.
 *
 * Two callers must never be forwarded, because for them the next step is not
 * reachable and the bounce becomes a loop:
 *
 *  - anyone on the terminal refusal, which is where the forwarding sends
 *    people who cannot finish setup in the first place.
 *  - anyone who does not already hold admin. A declarative config file can
 *    stamp a setup state complete before a single person has signed in, and
 *    forwarding the first user past the workspace step walks them past the only
 *    place that hands out the first admin. Only the step loaders can tell that
 *    first user from someone who will be refused, so they decide instead.
 */
export function mayForwardCompletedSetup(input: {
  pathname: string
  userRole?: string | null
}): boolean {
  if (input.pathname === ONBOARDING_NO_ACCESS) return false
  return isAdmin(input.userRole)
}

/**
 * Whether this caller has nothing to finish here, for the two reasons that mean
 * the same thing to them: somebody else already owns setup, or this is a
 * workspace a control plane created and its owner is recorded there rather than
 * decided by who arrives.
 *
 * One predicate, exported, because two places need the answer — the router and
 * the terminal page it routes to — and a terminal page that disagrees with its
 * own router bounces the visitor between them forever. That loop is what this
 * page was created to end.
 */
export function isSetupBlocked(state: OnboardingStateInput): boolean {
  if (isAdmin(state.principalRecord?.role)) return false
  if (state.setupClaimedByOther) return true
  return state.setupOpenToClaim === false
}

export function pickOnboardingStep({ session, state }: PickStepInput): OnboardingStep {
  if (!session?.userId) return '/onboarding/account'
  if (!state) return '/onboarding/workspace'

  // Signed in, but setup is not this caller's to finish. This has to be a page
  // inside the wizard: routing out to a sign-in route sent the visitor through
  // the root gate, which redirects back into onboarding while setup is
  // unfinished, which routed them out again. And letting them walk on to the
  // workspace form only moved the refusal to the end of it.
  if (isSetupBlocked(state)) return ONBOARDING_NO_ACCESS

  // Nobody owns setup and this caller does not hold admin yet. The workspace
  // step is where a workspace is claimed, so it comes before any step a
  // pre-stamped setup state would otherwise let them skip to — a declarative
  // config file can stamp the workspace step before anyone has signed in, and
  // skipping past the claim leaves the wizard's later actions refusing them.
  if (!state.principalRecord || !isAdmin(state.principalRecord.role)) {
    return '/onboarding/workspace'
  }

  // Route to the FIRST incomplete step in wizard order. Whatever the
  // orchestrator (or self-hosted operator) hasn't already stamped on
  // setupState becomes the user's next click. Earlier revisions
  // jumped straight to /onboarding/boards as soon as steps.workspace
  // was true, but that left useCase silently false-checkmarked when
  // an external pre-seed populated workspace without picking a use
  // case.
  if (state.setupOpenToClaim === false) {
    if (!state.setupState?.workspaceDetailsSeenAt) return '/onboarding/workspace'
    // A provision stamp may pre-fill a goal. The owner still chooses one.
    if (!state.setupState.useCase || state.setupState.steps.startingPoint?.source === 'managed') {
      return '/onboarding/usecase'
    }
  } else if (!state.setupState?.useCase || !state.setupState.steps.workspace) {
    return '/onboarding/workspace'
  }
  if (!state.setupState.activationHandoffSeenAt) return '/onboarding/complete'
  return '/admin/getting-started'
}
