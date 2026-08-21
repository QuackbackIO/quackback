import { describe, expect, it } from 'vitest'
import { mayForwardCompletedSetup, pickOnboardingStep } from '../-onboarding-step'
import { DEFAULT_SETUP_STATE, type SetupState } from '@/lib/shared/db-types'

function state(overrides: Partial<SetupState> = {}): SetupState {
  return {
    version: 2,
    steps: { core: true, workspace: false, startingPoint: null },
    ...overrides,
  }
}

const principalRecord = { id: 'p1', role: 'admin' }

describe('pickOnboardingStep V2', () => {
  it('routes unauthenticated visitors to account creation', () => {
    expect(pickOnboardingStep({ session: null, state: null })).toBe('/onboarding/account')
  })

  // Someone who is signed in but does not own setup has to land somewhere they
  // can act on. Sending them to a sign-in route sends them back through the
  // root gate, which returns them here, which sends them out again: the wizard
  // has to answer with a page of its own instead.
  it('routes a signed-in visitor with no principal to the terminal no-access page', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: { setupClaimedByOther: true, setupState: null, principalRecord: null },
      })
    ).toBe('/onboarding/no-access')
  })

  // The variant that matters more: every account gets a principal at creation,
  // so a non-owner signing in on the account screen arrives WITH one. Routing
  // on the principal's presence sent them into the workspace form, where the
  // bootstrap guard refused them mid-wizard.
  it('routes a signed-in non-owner who already has a principal to the same page', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u_visitor' },
        state: {
          setupClaimedByOther: true,
          setupState: null,
          principalRecord: { id: 'p_visitor', role: 'user' },
        },
      })
    ).toBe('/onboarding/no-access')
  })

  // The mirror image: nobody owns setup, so this caller may claim it even
  // though their principal was created with the default role.
  it('lets a first user with a default-role principal reach the workspace step', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u_first' },
        state: {
          setupClaimedByOther: false,
          setupState: null,
          principalRecord: { id: 'p_first', role: 'user' },
        },
      })
    ).toBe('/onboarding/workspace')
  })

  // A workspace a control plane created reads unclaimed until its owner
  // arrives. Routing on `setupClaimedByOther` alone therefore walked a stranger
  // into the workspace form — and, before the promoter refused, all the way to
  // admin. Routing them to the terminal page is the same answer the form now
  // gives, arrived at before they fill it in.
  it('routes an arrival on a provisioned workspace to the terminal page', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u_visitor' },
        state: {
          setupClaimedByOther: false,
          setupOpenToClaim: false,
          setupState: null,
          principalRecord: { id: 'p_visitor', role: 'user' },
        },
      })
    ).toBe('/onboarding/no-access')
  })

  // The control: one fact different, and the same caller belongs in the wizard.
  it('still sends the first user of an unprovisioned install to the claim step', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u_first' },
        state: {
          setupClaimedByOther: false,
          setupOpenToClaim: true,
          setupState: null,
          principalRecord: { id: 'p_first', role: 'user' },
        },
      })
    ).toBe('/onboarding/workspace')
  })

  // The recorded owner of a provisioned workspace already holds admin, so the
  // same "not open to claim" fact must not shut them out of their own setup.
  it('does not shut the recorded owner out of a provisioned workspace', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u_owner' },
        state: {
          setupClaimedByOther: false,
          setupOpenToClaim: false,
          setupState: null,
          principalRecord: { id: 'p_owner', role: 'admin' },
        },
      })
    ).toBe('/onboarding/workspace')
  })

  it('asks a provisioned owner for their outcome after workspace details', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u_owner' },
        state: {
          setupClaimedByOther: false,
          setupOpenToClaim: false,
          setupState: state({ workspaceDetailsSeenAt: '2026-08-14T10:00:00.000Z' }),
          principalRecord: { id: 'p_owner', role: 'admin' },
        },
      })
    ).toBe('/onboarding/usecase')
  })

  it('routes a provisioned owner with details and an outcome to the ready step', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u_owner' },
        state: {
          setupClaimedByOther: false,
          setupOpenToClaim: false,
          setupState: state({
            workspaceDetailsSeenAt: '2026-08-14T10:00:00.000Z',
            useCase: 'product_feedback',
          }),
          principalRecord: { id: 'p_owner', role: 'admin' },
        },
      })
    ).toBe('/onboarding/complete')
  })

  it('does not let a pre-seeded outcome skip cloud workspace details', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u_owner' },
        state: {
          setupClaimedByOther: false,
          setupOpenToClaim: false,
          setupState: state({ useCase: 'product_feedback' }),
          principalRecord: { id: 'p_owner', role: 'admin' },
        },
      })
    ).toBe('/onboarding/workspace')
  })

  it('does not let a provision stamp skip the goal or starter steps', () => {
    const stamped = state({
      workspaceDetailsSeenAt: '2026-08-14T10:00:00.000Z',
      useCase: 'product_feedback',
      completionSource: 'managed',
      steps: {
        core: true,
        workspace: true,
        startingPoint: {
          outcome: 'product_feedback',
          resourceType: 'none',
          source: 'managed',
          resolution: 'configured',
          completedAt: '2026-08-14T10:00:00.000Z',
        },
      },
    })
    expect(
      pickOnboardingStep({
        session: { userId: 'u_owner' },
        state: {
          setupClaimedByOther: false,
          setupOpenToClaim: false,
          setupState: stamped,
          principalRecord: { id: 'p_owner', role: 'admin' },
        },
      })
    ).toBe('/onboarding/usecase')
  })

  // The workspace step is where a workspace is claimed, and the declarative
  // config file can stamp the wizard's steps before anyone has ever signed in.
  // Routing on the stamp alone sent the first user past the only place that
  // hands out the first admin, into steps that then refuse them.
  it('sends the first user of a pre-stamped workspace to the claim step anyway', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u_first' },
        state: {
          setupClaimedByOther: false,
          setupState: state({
            useCase: 'product_feedback',
            steps: { core: true, workspace: true, startingPoint: null },
          }),
          principalRecord: { id: 'p_first', role: 'user' },
        },
      })
    ).toBe('/onboarding/workspace')
  })

  // A workspace that arrives with its owner already seeded starts on the
  // shipped setup state. That owner exists here already, so the wizard must
  // open at the workspace step rather than ask them to create an account.
  it('starts a seeded owner at the workspace step, not account creation', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'user_owner' },
        state: {
          setupClaimedByOther: false,
          setupState: DEFAULT_SETUP_STATE,
          principalRecord: { id: 'p_owner', role: 'admin' },
        },
      })
    ).toBe('/onboarding/workspace')
  })

  it('combines a missing workspace or goal into one step', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: { setupState: state(), principalRecord },
      })
    ).toBe('/onboarding/workspace')
  })

  it('routes configured workspace and goal to the ready step', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: {
          setupState: state({
            useCase: 'product_feedback',
            steps: { core: true, workspace: true, startingPoint: null },
          }),
          principalRecord,
        },
      })
    ).toBe('/onboarding/complete')
  })

  it('shows the bridge until it is acknowledged', () => {
    const completedAt = '2026-07-13T10:00:00.000Z'
    const setupState = state({
      useCase: 'customer_support',
      steps: {
        core: true,
        workspace: true,
        startingPoint: {
          outcome: 'customer_support',
          resourceType: 'messenger',
          source: 'wizard',
          resolution: 'configured',
          completedAt,
        },
      },
      completedAt,
    })
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: { setupState, principalRecord },
      })
    ).toBe('/onboarding/complete')
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: {
          setupState: { ...setupState, activationHandoffSeenAt: completedAt },
          principalRecord,
        },
      })
    ).toBe('/admin/getting-started')
  })
})

/**
 * The wizard layout forwards past the steps when the setup state reads
 * complete. Two callers must never be forwarded, because for them the step it
 * forwards to sends them straight back: the terminal refusal, and anyone who
 * has not been made an admin yet.
 */
describe('mayForwardCompletedSetup', () => {
  it('forwards an admin on a wizard step', () => {
    expect(mayForwardCompletedSetup({ pathname: '/onboarding/boards', userRole: 'admin' })).toBe(
      true
    )
  })

  it('never forwards anyone off the terminal refusal', () => {
    expect(mayForwardCompletedSetup({ pathname: '/onboarding/no-access', userRole: 'admin' })).toBe(
      false
    )
  })

  // A config file can stamp a setup state complete before anyone has signed in.
  // Forwarding this caller to the handoff walks them past the only step that
  // hands out the first admin, and every later action then refuses them.
  it('does not forward a caller who does not hold admin yet', () => {
    expect(mayForwardCompletedSetup({ pathname: '/onboarding/workspace', userRole: 'user' })).toBe(
      false
    )
    expect(mayForwardCompletedSetup({ pathname: '/onboarding/workspace', userRole: null })).toBe(
      false
    )
    expect(
      mayForwardCompletedSetup({ pathname: '/onboarding/workspace', userRole: 'member' })
    ).toBe(false)
  })
})
