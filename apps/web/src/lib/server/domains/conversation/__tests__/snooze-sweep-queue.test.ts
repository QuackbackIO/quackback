/**
 * The snooze-sweep tick carries three sweeps: snooze wake, AI assumed
 * resolution and pending AI action expiry. One failing must not block the
 * others or fail the job (JOB-12).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  wake: vi.fn(),
  finalize: vi.fn(),
  expire: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@/lib/server/logger', () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() }
  return { logger: { child: () => log } }
})
vi.mock('@/lib/server/jobs/deadlines', () => ({
  dueWithin: vi.fn(),
  registerWorkspaceDeadline: vi.fn(),
}))
vi.mock('@/lib/server/domains/assistant', () => ({
  ASSUMED_RESOLUTION_INACTIVITY_MINUTES: 30,
  finalizeStaleAssistantInvolvements: mocks.finalize,
}))
vi.mock('@/lib/server/domains/assistant/pending-actions.service', () => ({
  sweepAndNotifyExpiredPendingActions: mocks.expire,
}))
vi.mock('../conversation.service', () => ({ sweepDueSnoozedConversations: mocks.wake }))

import { runSnoozeSweepAt } from '../snooze-sweep-queue'

const now = new Date('2026-11-19T10:00:00.000Z')

beforeEach(() => {
  mocks.wake.mockReset().mockResolvedValue({ woken: 2 })
  mocks.finalize.mockReset().mockResolvedValue({ resolved: 0 })
  mocks.expire.mockReset().mockResolvedValue([])
  mocks.warn.mockReset()
})

describe('the snooze-sweep tick', () => {
  it('JOB-12 still wakes snoozes and expires pending actions when the assumed-resolution sweep fails', async () => {
    mocks.finalize.mockRejectedValue(new Error('involvements table locked'))
    await expect(runSnoozeSweepAt(now)).resolves.toEqual({ woken: 2 })
    expect(mocks.wake).toHaveBeenCalledWith(now)
    expect(mocks.expire).toHaveBeenCalledWith(undefined, now)
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'assistant assumed-resolution sweep failed'
    )
  })

  it('a failing pending-action expiry is logged and the job still succeeds', async () => {
    mocks.expire.mockRejectedValue(new Error('boom'))
    await expect(runSnoozeSweepAt(now)).resolves.toEqual({ woken: 2 })
    expect(mocks.finalize).toHaveBeenCalledWith(30, undefined, now)
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'assistant pending-action expiry sweep failed'
    )
  })
})
