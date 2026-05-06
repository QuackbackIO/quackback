import { describe, it, expect } from 'vitest'
import { pickOnboardingStep } from '../onboarding-step'

describe('pickOnboardingStep', () => {
  it('routes unauthenticated visitors to /onboarding/account', () => {
    expect(pickOnboardingStep({ session: null, state: null })).toBe('/onboarding/account')
  })

  it('routes invitees to /auth/login', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: { needsInvitation: true, setupState: null, principalRecord: null },
      })
    ).toBe('/auth/login')
  })

  it('routes cloud-bootstrapped admins straight to /admin (skip wizard)', () => {
    // setupState.source==='cloud' means the workspace was provisioned and
    // bootstrapped by Quackback Cloud — the admin principal already
    // exists and the wizard would be a confusing dead-end.
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: {
          setupState: {
            version: 1,
            steps: { core: true, workspace: true, boards: true },
            source: 'cloud',
          },
          principalRecord: { id: 'p1', role: 'admin' },
        },
      })
    ).toBe('/admin')
  })

  it('routes mid-wizard users to /onboarding/boards when workspace step is done', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: {
          setupState: {
            version: 1,
            source: 'self-hosted',
            steps: { core: false, workspace: true, boards: false },
          },
          principalRecord: { id: 'p1', role: 'admin' },
        },
      })
    ).toBe('/onboarding/boards')
  })

  it('routes users with a useCase but no workspace to /onboarding/workspace', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: {
          setupState: {
            version: 1,
            source: 'self-hosted',
            useCase: 'saas',
            steps: { core: false, workspace: false, boards: false },
          },
          principalRecord: { id: 'p1', role: 'admin' },
        },
      })
    ).toBe('/onboarding/workspace')
  })

  it('falls back to /onboarding/usecase when nothing has been chosen', () => {
    expect(
      pickOnboardingStep({
        session: { userId: 'u1' },
        state: { setupState: null, principalRecord: null },
      })
    ).toBe('/onboarding/usecase')
  })
})
