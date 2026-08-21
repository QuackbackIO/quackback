/**
 * A real starter reports trial activation evidence to the control plane;
 * merely finishing setup does not. Retries reuse the stamped completion time.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { SetupState } from '@/lib/server/db'

const hoisted = vi.hoisted(() => ({
  state: null as unknown as SetupState,
  reportTrial: vi.fn(async (_opts: unknown) => 'started' as const),
  /** State as it stood at the moment activation was reported. */
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
    settings: { id: 'ws_1' },
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
      {
        id: 'ws_1',
        name: 'Acme',
        slug: 'acme',
        managedFieldPaths: [],
        // The product flags are stated rather than defaulted. Since 0268,
        // DEFAULT_FEATURE_FLAGS is core-only (Feedback + Changelog), so a null
        // blob resolves supportInbox/helpCenter off and every starter here
        // lands on `unavailable` instead of exercising the trial report.
        featureFlags: JSON.stringify({
          feedback: true,
          changelog: true,
          helpCenter: true,
          supportInbox: true,
          supportTickets: true,
        }),
      },
      { update: () => ({ set: () => ({ where: async () => undefined }) }) }
    )
    hoisted.state = result.state
    return result
  },
  acknowledgeActivationHandoff: vi.fn(),
}))

vi.mock('@/lib/server/control-plane/client', () => ({
  reportTrialActivation: (opts: unknown) => {
    hoisted.stateWhenTrialStarted = hoisted.state
    return hoisted.reportTrial(opts)
  },
}))

vi.mock('@/lib/server/plg-events', () => ({ emitPlgEvent: vi.fn(async () => undefined) }))

import { completeStartingPointFn, shouldStartTrialForStarter } from '../activation'

const FIRST_RUN = new Date('2026-03-01T12:00:00.000Z')
const SECOND_RUN = new Date('2026-03-09T08:30:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIRST_RUN)
  hoisted.reportTrial.mockClear()
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
  it('does not start a trial for a deferred starter', async () => {
    await completeStartingPointFn({ data: { action: 'defer' } } as never)
    expect(hoisted.reportTrial).not.toHaveBeenCalled()
  })

  it('still records deferred setup completion without touching the trial', async () => {
    await completeStartingPointFn({ data: { action: 'defer' } } as never)
    expect(hoisted.state.completedAt).toBe(FIRST_RUN.toISOString())
    expect(hoisted.state.steps.startingPoint).not.toBeNull()
    expect(hoisted.stateWhenTrialStarted).toBeNull()
  })

  it('does not start on a deferred retry days later', async () => {
    await completeStartingPointFn({ data: { action: 'defer' } } as never)
    vi.setSystemTime(SECOND_RUN)
    await completeStartingPointFn({ data: { action: 'defer' } } as never)

    expect(hoisted.reportTrial).not.toHaveBeenCalled()
    expect(hoisted.state.completedAt).toBe(FIRST_RUN.toISOString())
  })

  it('reports configured starter evidence with an immutable idempotency key', async () => {
    hoisted.state.useCase = 'customer_support'
    await completeStartingPointFn({ data: { action: 'complete' } } as never)
    vi.setSystemTime(SECOND_RUN)
    await completeStartingPointFn({ data: { action: 'complete' } } as never)

    expect(hoisted.reportTrial).toHaveBeenCalledTimes(2)
    expect(hoisted.reportTrial.mock.calls[0]?.[0]).toEqual({
      idempotencyKey: `starter:${FIRST_RUN.toISOString()}:messenger`,
      resolution: 'configured',
      artifactType: 'messenger',
      occurredAt: FIRST_RUN.toISOString(),
    })
    expect(hoisted.reportTrial.mock.calls[1]?.[0]).toEqual(hoisted.reportTrial.mock.calls[0]?.[0])
    expect(hoisted.stateWhenTrialStarted).toBe(hoisted.state)
  })

  it.each([
    ['created', true],
    ['configured', true],
    ['deferred', false],
    ['unavailable', false],
  ] as const)('starts only for a %s starter', (resolution, expected) => {
    expect(shouldStartTrialForStarter(resolution)).toBe(expected)
  })
})
