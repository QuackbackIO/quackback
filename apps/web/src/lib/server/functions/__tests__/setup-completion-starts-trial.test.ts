/**
 * Finishing setup is what starts a trial, and finishing it again is not.
 *
 * The trial's own behaviour is proven in
 * `domains/settings/cloud/__tests__/`. What can only be seen here is the
 * wiring: that the wizard's last step reaches the trial at all, and that the
 * moment it hands over is the workspace's *stamped* completion time rather
 * than the clock at the moment of the call. Those are the same value on the
 * first run and different values on every run after it, which is exactly why a
 * test that only ran the handler once would prove nothing.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { SetupState } from '@/lib/server/db'

const hoisted = vi.hoisted(() => ({
  state: null as unknown as SetupState,
  startTrial: vi.fn(async (_opts: { anchor: Date }) => ({
    started: true,
    reason: null,
    trial: null,
  })),
  /** State as it stood at the moment the trial was asked for. */
  stateWhenTrialStarted: null as SetupState | null,
}))

vi.mock('@tanstack/react-start', () => ({
  // Returns the handler itself, so each server fn is callable by name and no
  // test has to know the order they were declared in.
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: (args: unknown) => unknown) => fn,
    }
    return chain
  },
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 'usr_1' },
    principal: { id: 'prn_1', role: 'admin' },
  })),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(async () => ({ maxBoards: null })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => ({ from: () => ({ where: async () => [{ count: 0 }] }) }),
  },
}))

/**
 * A faithful stand-in for the real seam: it hands the callback the current
 * state and keeps whatever the callback returns. That fidelity is what makes
 * the second run meaningful, because the handler's own
 * `completedAt ?? now` decision is then exercised against a state that really
 * does already carry a completion stamp.
 */
vi.mock('@/lib/server/setup-state', () => ({
  mutateSetupStateAtomic: async (
    mutate: (
      current: SetupState,
      row: unknown,
      tx: unknown
    ) => Promise<{ state: SetupState; value: unknown }>
  ) => {
    const result = await mutate(
      hoisted.state,
      { id: 'ws_1', name: 'Acme', slug: 'acme', managedFieldPaths: [], featureFlags: null },
      {}
    )
    hoisted.state = result.state
    return result
  },
  acknowledgeActivationHandoff: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/cloud/trial', () => ({
  startTrialIfEligible: (opts: { anchor: Date }) => {
    hoisted.stateWhenTrialStarted = hoisted.state
    return hoisted.startTrial(opts)
  },
}))

import { completeStartingPointFn } from '../activation'

const FIRST_RUN = new Date('2026-03-01T12:00:00.000Z')
const SECOND_RUN = new Date('2026-03-09T08:30:00.000Z')

function anchors(): string[] {
  return hoisted.startTrial.mock.calls.map((call) => call[0].anchor.toISOString())
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIRST_RUN)
  hoisted.startTrial.mockClear()
  hoisted.stateWhenTrialStarted = null
  hoisted.state = {
    version: 2,
    steps: { core: true, workspace: true, startingPoint: null },
    useCase: 'product_feedback',
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('completing the wizard', () => {
  it('asks for a trial, anchored on when setup finished', async () => {
    await completeStartingPointFn({ data: { action: 'defer' } } as never)
    expect(anchors()).toEqual([FIRST_RUN.toISOString()])
  })

  it('asks only after setup is actually recorded as complete', async () => {
    // Ordering, not decoration: the trial write takes the same settings row
    // the setup-state transaction holds. Asking from inside that transaction
    // would deadlock a workspace against itself on the last click of its own
    // setup.
    await completeStartingPointFn({ data: { action: 'defer' } } as never)
    expect(hoisted.stateWhenTrialStarted?.completedAt).toBe(FIRST_RUN.toISOString())
    expect(hoisted.stateWhenTrialStarted?.steps.startingPoint).not.toBeNull()
  })

  it('passes the same moment when the step is completed again days later', async () => {
    // The anchor is what makes a repeat harmless: the same anchor recomputes
    // the same window, so a second attempt cannot buy another fortnight even
    // before the trial record itself is consulted.
    await completeStartingPointFn({ data: { action: 'defer' } } as never)
    vi.setSystemTime(SECOND_RUN)
    await completeStartingPointFn({ data: { action: 'defer' } } as never)

    expect(anchors()).toEqual([FIRST_RUN.toISOString(), FIRST_RUN.toISOString()])
    expect(hoisted.state.completedAt).toBe(FIRST_RUN.toISOString())
  })
})
