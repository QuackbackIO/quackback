import { describe, expect, it } from 'vitest'
import {
  getSetupState,
  isOnboardingComplete,
  normalizeOnboardingOutcome,
  normalizeSetupStateV2,
} from '../types'

describe('SetupState V2 normalization', () => {
  it('normalizes legacy outcomes onto the four activation goals', () => {
    expect(normalizeOnboardingOutcome('saas')).toBe('product_feedback')
    expect(normalizeOnboardingOutcome('consumer')).toBe('product_feedback')
    expect(normalizeOnboardingOutcome('customer_support')).toBe('customer_support')
    expect(normalizeOnboardingOutcome('unknown')).toBeUndefined()
  })

  it('protects an established completed workspace from a new handoff', () => {
    const normalized = normalizeSetupStateV2({
      version: 1,
      steps: { core: true, workspace: true, boards: true },
      useCase: 'help_center',
      completedAt: '2026-01-02T03:04:05.000Z',
    })

    expect(normalized).toEqual({
      version: 2,
      steps: {
        core: true,
        workspace: true,
        startingPoint: {
          outcome: 'help_center',
          resourceType: 'none',
          source: 'existing',
          resolution: 'deferred',
          completedAt: '2026-01-02T03:04:05.000Z',
        },
      },
      useCase: 'help_center',
      completedAt: '2026-01-02T03:04:05.000Z',
      completionSource: 'legacy',
      activationHandoffSeenAt: '2026-01-02T03:04:05.000Z',
    })
    expect(isOnboardingComplete(normalized)).toBe(true)
  })

  it('preserves known completion provenance from an older record', () => {
    const normalized = normalizeSetupStateV2({
      version: 1,
      steps: { core: true, workspace: true, boards: true },
      completionSource: 'managed',
    })
    expect(normalized?.completionSource).toBe('managed')
    expect(normalized?.activationHandoffSeenAt).toBe('1970-01-01T00:00:00.000Z')
  })

  it('migrates required skips to later and optional skips to hidden', () => {
    const normalized = normalizeSetupStateV2({
      version: 1,
      steps: { core: true, workspace: false, boards: false },
      useCase: 'product_feedback',
      skippedLaunchTasks: ['add-to-site', 'customize-branding', 'connect-integration'],
    })

    expect(normalized?.steps.startingPoint).toBeNull()
    expect(normalized?.taskResolutions?.product_feedback).toEqual({
      'add-to-site': {
        resolution: 'deferred',
        resolvedAt: '1970-01-01T00:00:00.000Z',
      },
      'customize-branding': {
        resolution: 'dismissed',
        resolvedAt: '1970-01-01T00:00:00.000Z',
      },
      'connect-integration': {
        resolution: 'dismissed',
        resolvedAt: '1970-01-01T00:00:00.000Z',
      },
    })
    expect(isOnboardingComplete(normalized)).toBe(false)
  })

  it('sanitizes malformed V2 fields without changing valid state', () => {
    const normalized = normalizeSetupStateV2({
      version: 2,
      steps: {
        core: true,
        workspace: true,
        startingPoint: {
          outcome: 'internal',
          resourceType: 'board',
          resourceId: 'board_1',
          source: 'wizard',
          resolution: 'created',
          completedAt: '2026-02-01T00:00:00.000Z',
        },
      },
      useCase: 'internal',
      taskResolutions: {
        internal: {
          'invite-team': {
            resolution: 'deferred',
            resolvedAt: '2026-02-02T00:00:00.000Z',
          },
          invalid: { resolution: 'complete', resolvedAt: 'not-a-date' },
        },
      },
    })

    expect(normalized?.steps.startingPoint?.resourceId).toBe('board_1')
    expect(normalized?.taskResolutions).toEqual({
      internal: {
        'invite-team': {
          resolution: 'deferred',
          resolvedAt: '2026-02-02T00:00:00.000Z',
        },
      },
    })
  })

  it('fails closed for invalid JSON', () => {
    expect(getSetupState('{not json')).toBeNull()
    expect(normalizeSetupStateV2(null)).toBeNull()
  })
})
