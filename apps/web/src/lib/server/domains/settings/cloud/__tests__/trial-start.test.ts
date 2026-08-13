/**
 * Starting a trial, and the one thing that must never happen: a second one.
 *
 * The test harness is a fake settings row that the real `writeCloudConfig`
 * reads, locks and writes back, with the read side (`getWorkspaceSettings`)
 * served from the *same* row. That fidelity is the point: a double that
 * accepted writes and never showed them again would make "starting twice does
 * not extend it" pass no matter what the code did, because the second call
 * would always see a workspace with no trial and the assertion would be about
 * nothing.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { StoredCloudConfig } from '@/lib/shared/db-types'
import { presentPlanNotice } from '@/lib/shared/plan-notice'

const hoisted = vi.hoisted(() => ({
  state: {
    row: null as null | {
      id: string
      cloud: Record<string, unknown> | null
      cloudRevision: number
      managedFieldPaths: string[]
    },
    writes: 0,
    failWrite: false,
  },
  mockInvalidate: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      if (hoisted.state.failWrite) throw new Error('database unavailable')
      const tx = {
        select: () => ({
          from: () => ({
            limit: () => ({
              for: () => Promise.resolve(hoisted.state.row ? [hoisted.state.row] : []),
            }),
          }),
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => {
            // A real write lands in the row, so the next read sees it. The
            // auth-config bump is a second `set()` with no `cloud` key.
            if (values && typeof values === 'object' && 'cloud' in values) {
              hoisted.state.writes++
              hoisted.state.row!.cloud = values.cloud as Record<string, unknown>
              hoisted.state.row!.cloudRevision = values.cloudRevision as number
              return { where: async () => {} }
            }
            return Promise.resolve() as unknown as { where: () => Promise<void> }
          },
        }),
      }
      return await callback(tx)
    },
  },
}))

vi.mock('../../settings.helpers', () => ({
  invalidateSettingsCache: hoisted.mockInvalidate,
}))

vi.mock('../../settings.service', () => ({
  getWorkspaceSettings: async () => ({ settings: { cloud: hoisted.state.row?.cloud ?? null } }),
}))

import { resolveCloudConfig, writeCloudConfig } from '../cloud.service'
import { PLAN_CATALOGUE } from '../cloud.types'
import { TRIAL_DAYS, TRIAL_PLAN, startTrialIfEligible, trialNotice } from '../trial'

/** Setup completed here. Permanently in the past, so nothing rots. */
const ANCHOR = new Date('2026-03-01T00:00:00.000Z')
const LATER = new Date('2026-03-04T09:15:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const EXPECTED_END = new Date(ANCHOR.getTime() + TRIAL_DAYS * DAY_MS).toISOString()

function seed(cloud: Record<string, unknown> | null, managedFieldPaths: string[] = []): void {
  hoisted.state.row = { id: 'ws_1', cloud, cloudRevision: 0, managedFieldPaths }
  hoisted.state.writes = 0
  hoisted.state.failWrite = false
  hoisted.mockInvalidate.mockClear()
}

function storedCloud(): StoredCloudConfig {
  return hoisted.state.row?.cloud as unknown as StoredCloudConfig
}

function storedTrial(): unknown {
  return storedCloud()?.trial
}

beforeEach(() => {
  seed(null)
})

describe('a workspace that has just finished setting up', () => {
  beforeEach(() => {
    seed({ enabled: true, plan: 'free', entitlements: {}, billing: {} })
  })

  it('gets a trial on a paid plan, anchored on when setup finished', async () => {
    const result = await startTrialIfEligible({ anchor: ANCHOR })
    expect(result).toEqual({
      started: true,
      reason: null,
      trial: { plan: TRIAL_PLAN, startedAt: ANCHOR.toISOString(), endsAt: EXPECTED_END },
    })
    expect(storedTrial()).toEqual(result.trial)
  })

  it('holds the trial plan from that moment, and Free once it runs out', async () => {
    await startTrialIfEligible({ anchor: ANCHOR })
    const stored = storedCloud()
    const inside = new Date(Date.parse(EXPECTED_END) - 1)
    const outside = new Date(Date.parse(EXPECTED_END))
    expect(resolveCloudConfig(stored, inside).plan).toBe(TRIAL_PLAN)
    expect(resolveCloudConfig(stored, outside).plan).toBe('free')
  })

  it('leaves the stored plan alone, because that is what it falls back to', async () => {
    // If the trial wrote `plan` instead, the periodic reconcile would assert
    // Free over it within the quarter hour and the trial would be gone.
    await startTrialIfEligible({ anchor: ANCHOR })
    expect(storedCloud().plan).toBe('free')
  })
})

describe('starting a trial twice', () => {
  beforeEach(() => {
    seed({ enabled: true, plan: 'free', entitlements: {}, billing: {} })
  })

  it('does not extend it when the page is revisited days later', async () => {
    const first = await startTrialIfEligible({ anchor: ANCHOR })
    const second = await startTrialIfEligible({ anchor: LATER })
    expect(second).toEqual({ started: false, reason: 'already_recorded', trial: first.trial })
    expect(storedTrial()).toEqual(first.trial)
  })

  it('does not extend it even after it has already ended', async () => {
    // The record outliving the trial is the only thing standing between a
    // workspace and an unlimited number of fortnights.
    const first = await startTrialIfEligible({ anchor: ANCHOR })
    const wayLater = new Date(Date.parse(EXPECTED_END) + 90 * DAY_MS)
    const second = await startTrialIfEligible({ anchor: wayLater })
    expect(second.started).toBe(false)
    expect(storedTrial()).toEqual(first.trial)
  })

  it('writes once, not twice, when the same anchor arrives again', async () => {
    // A double-clicked Finish button. Because the window is derived from the
    // anchor rather than from the clock, the second merge is identical to the
    // stored one and collapses to a no-op: no revision bump, no cache bust.
    await startTrialIfEligible({ anchor: ANCHOR })
    const writesAfterFirst = hoisted.state.writes
    const revisionAfterFirst = hoisted.state.row!.cloudRevision
    hoisted.mockInvalidate.mockClear()

    await startTrialIfEligible({ anchor: ANCHOR })
    expect(hoisted.state.writes).toBe(writesAfterFirst)
    expect(hoisted.state.row!.cloudRevision).toBe(revisionAfterFirst)
    expect(hoisted.mockInvalidate).not.toHaveBeenCalled()
  })
})

describe('two writers, one column', () => {
  it('starts a trial on a workspace whose plan the config file pins', async () => {
    // The arrangement a managed deployment actually runs: the file owns the
    // master switch and the plan, and everything it did not claim is the other
    // writer's. A trial must fit in that gap rather than needing the plan.
    seed({ enabled: true, plan: 'free' }, ['cloud.enabled', 'cloud.plan'])
    const result = await startTrialIfEligible({ anchor: ANCHOR })
    expect(result.started).toBe(true)
    expect(storedCloud().plan).toBe('free')
    expect(storedTrial()).toEqual(result.trial)
  })

  it('survives a config-file write arriving afterwards, through the real seam', async () => {
    // Not the merge in isolation: the whole write path, in the order it
    // happens. The reconciler polls every 30 seconds, so if a config write
    // dropped the trial no trial would ever reach its second minute.
    seed({ enabled: true, plan: 'free' })
    const started = await startTrialIfEligible({ anchor: ANCHOR })
    await writeCloudConfig({ enabled: true, plan: 'free' }, { writer: 'config' })
    expect(storedTrial()).toEqual(started.trial)

    const midTrial = new Date(ANCHOR.getTime() + DAY_MS)
    expect(resolveCloudConfig(storedCloud(), midTrial).plan).toBe(TRIAL_PLAN)
  })
})

describe('workspaces that get no trial', () => {
  it('a self-hosted install: nothing is read, nothing is written, no trial', async () => {
    seed(null)
    const result = await startTrialIfEligible({ anchor: ANCHOR })
    expect(result).toEqual({ started: false, reason: 'cloud_disabled', trial: null })
    expect(hoisted.state.writes).toBe(0)
    expect(hoisted.state.row!.cloud).toBeNull()
  })

  it('an install with the block present but switched off', async () => {
    seed({ enabled: false, plan: 'free' })
    const result = await startTrialIfEligible({ anchor: ANCHOR })
    expect(result.started).toBe(false)
    expect(hoisted.state.writes).toBe(0)
  })

  it('a workspace that already has a subscription', async () => {
    seed({
      enabled: true,
      plan: 'pro',
      billing: { provider: 'acme', customerRef: 'cus_1', subscriptionRef: 'sub_1' },
    })
    const result = await startTrialIfEligible({ anchor: ANCHOR })
    expect(result).toEqual({ started: false, reason: 'has_subscription', trial: null })
    expect(hoisted.state.writes).toBe(0)
  })

  it('reports rather than raises when the write itself fails', async () => {
    // This is called as the last step of finishing setup. A workspace that has
    // just been built must be let in whether or not a commercial courtesy
    // could be recorded, so the failure is a logged non-event and never an
    // exception travelling up into the wizard.
    seed({ enabled: true, plan: 'free' })
    hoisted.state.failWrite = true
    await expect(startTrialIfEligible({ anchor: ANCHOR })).resolves.toEqual({
      started: false,
      reason: 'refused',
      trial: null,
    })
  })

  it('a workspace whose trial fields the config file has claimed', async () => {
    // The file wins where it declares. Setup completing is a request a human
    // is waiting on, so the refusal is recorded and swallowed rather than
    // failing the wizard over a commercial nicety.
    seed({ enabled: true, plan: 'free' }, ['cloud'])
    const result = await startTrialIfEligible({ anchor: ANCHOR })
    expect(result).toEqual({ started: false, reason: 'refused', trial: null })
    expect(hoisted.state.writes).toBe(0)
  })
})

describe('the countdown a workspace sees', () => {
  const trial = {
    plan: 'pro' as const,
    startedAt: ANCHOR.toISOString(),
    endsAt: EXPECTED_END,
  }
  const row: StoredCloudConfig = {
    enabled: true,
    plan: 'free',
    entitlements: {},
    billing: {},
    trial,
    upgradeUrl: 'https://example.com/plans',
  } as StoredCloudConfig

  it('names the plan and the day it ends', () => {
    const twoDaysIn = new Date(ANCHOR.getTime() + 2 * DAY_MS)
    const notice = trialNotice(resolveCloudConfig(row, twoDaysIn))
    expect(notice).toEqual({
      label: `${PLAN_CATALOGUE[TRIAL_PLAN].name} trial`,
      message: expect.stringContaining('Free'),
      expiresAt: EXPECTED_END,
      actionUrl: 'https://example.com/plans',
      actionLabel: 'See plans',
    })
  })

  it('counts down to the day it ends', () => {
    const twoDaysIn = new Date(ANCHOR.getTime() + 2 * DAY_MS)
    const view = presentPlanNotice(trialNotice(resolveCloudConfig(row, twoDaysIn)), twoDaysIn)
    expect(view?.daysLeft).toBe(TRIAL_DAYS - 2)
  })

  it('turns urgent in the last days rather than only at the end', () => {
    const nearlyOver = new Date(Date.parse(EXPECTED_END) - 2 * DAY_MS)
    const view = presentPlanNotice(trialNotice(resolveCloudConfig(row, nearlyOver)), nearlyOver)
    expect({ daysLeft: view?.daysLeft, urgent: view?.urgent }).toEqual({
      daysLeft: 2,
      urgent: true,
    })
  })

  it('says nothing at all once the trial is over', () => {
    const after = new Date(Date.parse(EXPECTED_END) + DAY_MS)
    expect(trialNotice(resolveCloudConfig(row, after))).toBeNull()
  })

  it('says nothing on a workspace that never had one', () => {
    const plain = { enabled: true, plan: 'free' } as StoredCloudConfig
    expect(trialNotice(resolveCloudConfig(plain, ANCHOR))).toBeNull()
  })

  it('says nothing on a self-hosted install, mid-window or not', () => {
    const selfHosted = { ...row, enabled: false } as StoredCloudConfig
    const twoDaysIn = new Date(ANCHOR.getTime() + 2 * DAY_MS)
    expect(trialNotice(resolveCloudConfig(selfHosted, twoDaysIn))).toBeNull()
    expect(trialNotice(resolveCloudConfig(selfHosted, ANCHOR))).toBeNull()
  })

  it('stays silent when the master switch is off, whatever else the config says', () => {
    // The half-written shape: a config carrying a live trial with cloud off.
    // `enabled` must dominate here for the same reason it dominates in
    // `isEntitled` — a self-hosted install must not be shown a countdown to a
    // downgrade that will never happen.
    expect(
      trialNotice({
        ...resolveCloudConfig(row, new Date(ANCHOR.getTime() + DAY_MS)),
        enabled: false,
      })
    ).toBeNull()
  })

  it('sends See plans to the workspace billing page when no upgradeUrl is set', () => {
    const noUrl = { ...row, upgradeUrl: undefined } as StoredCloudConfig
    const twoDaysIn = new Date(ANCHOR.getTime() + 2 * DAY_MS)
    const notice = trialNotice(resolveCloudConfig(noUrl, twoDaysIn))
    expect(notice?.actionUrl).toBe('/admin/settings/billing')
    expect(notice?.actionLabel).toBe('See plans')
    expect(notice?.label).toBe(`${PLAN_CATALOGUE[TRIAL_PLAN].name} trial`)
  })
})
