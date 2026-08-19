import { describe, expect, it } from 'vitest'
import { pickOnboardingStep } from '../-onboarding-step'
import type { SetupState } from '@/lib/shared/db-types'

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

  it('routes invitees to sign in', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: { needsInvitation: true, setupState: null, principalRecord: null },
      })
    ).toBe('/auth/login')
  })

  it('combines a missing workspace or goal into one step', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: { setupState: state(), principalRecord },
      })
    ).toBe('/onboarding/workspace')
  })

  it('routes configured workspace and goal to the starting point', () => {
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
    ).toBe('/onboarding/boards')
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
    ).toBe('/admin')
  })
})
