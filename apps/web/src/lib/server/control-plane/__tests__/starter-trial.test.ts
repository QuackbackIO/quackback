import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetupState } from '@/lib/shared/db-types'
import { starterTrialEvidence, reportStarterTrialIfDue } from '../starter-trial'

const hoisted = vi.hoisted(() => ({
  getCloudConfig: vi.fn(),
  getWorkspaceSettings: vi.fn(),
  reportTrialActivation: vi.fn(),
  emitPlgEvent: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig: hoisted.getCloudConfig,
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.getWorkspaceSettings,
}))

vi.mock('@/lib/server/control-plane/client', () => ({
  reportTrialActivation: hoisted.reportTrialActivation,
}))

vi.mock('@/lib/server/plg-events', () => ({
  emitPlgEvent: hoisted.emitPlgEvent,
}))

const COMPLETED = '2026-08-14T19:04:59.476Z'

function setup(overrides: Partial<SetupState> = {}): SetupState {
  return {
    version: 2,
    steps: {
      core: true,
      workspace: true,
      startingPoint: {
        outcome: 'product_feedback',
        resourceType: 'board',
        source: 'existing',
        resolution: 'configured',
        completedAt: COMPLETED,
      },
    },
    completedAt: COMPLETED,
    useCase: 'product_feedback',
    ...overrides,
  }
}

describe('starterTrialEvidence', () => {
  it('uses the stamped completion time so a later retry is the same evidence', () => {
    expect(starterTrialEvidence(setup())).toEqual({
      idempotencyKey: `starter:${COMPLETED}:board`,
      resolution: 'configured',
      artifactType: 'board',
      occurredAt: COMPLETED,
    })
  })

  it('does not start a trial for deferred or unavailable starters', () => {
    for (const resolution of ['deferred', 'unavailable'] as const) {
      expect(
        starterTrialEvidence(
          setup({
            steps: {
              core: true,
              workspace: true,
              startingPoint: {
                outcome: 'product_feedback',
                resourceType: 'none',
                source: 'wizard',
                resolution,
                completedAt: COMPLETED,
              },
            },
          })
        )
      ).toBeNull()
    }
  })
})

describe('reportStarterTrialIfDue', () => {
  beforeEach(() => {
    hoisted.getCloudConfig.mockReset()
    hoisted.getWorkspaceSettings.mockReset()
    hoisted.reportTrialActivation.mockReset()
    hoisted.emitPlgEvent.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('skips self-host and workspaces that already have a trial', async () => {
    hoisted.getCloudConfig.mockResolvedValueOnce({ enabled: false, trialStartedAt: null })
    await expect(reportStarterTrialIfDue()).resolves.toBe('skipped')
    hoisted.getCloudConfig.mockResolvedValueOnce({
      enabled: true,
      trialStartedAt: '2026-08-14T19:24:04.355Z',
    })
    await expect(reportStarterTrialIfDue()).resolves.toBe('skipped')
    expect(hoisted.reportTrialActivation).not.toHaveBeenCalled()
  })

  it('skips complimentary grants and paid plans that omit trial timestamps', async () => {
    hoisted.getCloudConfig.mockResolvedValueOnce({
      enabled: true,
      plan: 'scale',
      trialStartedAt: null,
      trialActive: false,
      subscriptionStatus: null,
    })
    await expect(reportStarterTrialIfDue()).resolves.toBe('skipped')
    hoisted.getCloudConfig.mockResolvedValueOnce({
      enabled: true,
      plan: 'pro',
      trialStartedAt: null,
      trialActive: false,
      subscriptionStatus: 'active',
    })
    await expect(reportStarterTrialIfDue()).resolves.toBe('skipped')
    expect(hoisted.reportTrialActivation).not.toHaveBeenCalled()
  })

  it('still reports after a canceled subscription on Free', async () => {
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      plan: 'free',
      trialStartedAt: null,
      trialActive: false,
      subscriptionStatus: 'canceled',
    })
    hoisted.getWorkspaceSettings.mockResolvedValue({
      settings: { id: 'ws_1', setupState: JSON.stringify(setup()) },
    })
    hoisted.reportTrialActivation.mockResolvedValue('started')
    await expect(reportStarterTrialIfDue()).resolves.toBe('started')
    expect(hoisted.reportTrialActivation).toHaveBeenCalled()
  })

  it('reports the stamped evidence when Cloud is on and no trial has landed', async () => {
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      plan: 'free',
      trialStartedAt: null,
      trialActive: false,
      subscriptionStatus: null,
    })
    hoisted.getWorkspaceSettings.mockResolvedValue({
      settings: { id: 'ws_1', setupState: JSON.stringify(setup()) },
    })
    hoisted.reportTrialActivation.mockResolvedValue('started')

    await expect(reportStarterTrialIfDue({ principalId: 'prn_1' })).resolves.toBe('started')
    expect(hoisted.reportTrialActivation).toHaveBeenCalledWith({
      idempotencyKey: `starter:${COMPLETED}:board`,
      resolution: 'configured',
      artifactType: 'board',
      occurredAt: COMPLETED,
    })
    expect(hoisted.emitPlgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'trial_started', artifactType: 'board' }),
      { workspaceId: 'ws_1', principalId: 'prn_1' }
    )
  })

  it('does not block the admin surface when the control plane is down', async () => {
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      plan: 'free',
      trialStartedAt: null,
      trialActive: false,
      subscriptionStatus: null,
    })
    hoisted.getWorkspaceSettings.mockResolvedValue({
      settings: { id: 'ws_1', setupState: JSON.stringify(setup()) },
    })
    hoisted.reportTrialActivation.mockRejectedValue(new Error('temporarily unavailable'))
    await expect(reportStarterTrialIfDue()).resolves.toBe('skipped')
  })
})
