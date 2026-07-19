/**
 * Mocked-db coverage for the ticket TTR settle-write CAS guard (support
 * platform §4.6): commitTicketClockEvent (used by recordTicketResolution)
 * must be guarded on `(appliedAt, pausedAt)` the same way pause/resume
 * already are, and retry exactly once against a freshly-reloaded stamp when
 * that guard misses. This can't be exercised against the real-DB fixture (a
 * single transaction/connection can't produce a genuine concurrent
 * interleaving), so `db` is fully mocked here to script the two reads and
 * (up to) two guarded writes each test needs — the same approach as
 * sla.service.settle-guard.test.ts, whose conversation-side cases this
 * mirrors.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TicketId } from '@quackback/ids'

// Queued results for db.select(...).from(...).where(...).limit(...) and
// db.update(...).set(...).where(...).returning(...), consumed FIFO per call —
// this is what lets a test script "read #1, write #1 (miss), read #2 (fresh
// state), write #2 (hit)" deterministically.
let selectQueue: unknown[][] = []
let updateQueue: unknown[][] = []
const setCalls: unknown[] = []
const insertCalls: unknown[] = []

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((patch: unknown) => {
          setCalls.push(patch)
          return {
            where: vi.fn(() => ({
              returning: vi.fn(() => Promise.resolve(updateQueue.shift() ?? [])),
            })),
          }
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: unknown) => {
          insertCalls.push(values)
          return Promise.resolve(undefined)
        }),
      })),
    },
  }
})

import { recordTicketResolution, type TicketSlaApplied } from '../ticket-sla.service'

const ticketId = 'ticket_1' as TicketId

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue = []
  updateQueue = []
  setCalls.length = 0
  insertCalls.length = 0
})

describe('ticket settle-vs-resume interleaving', () => {
  it('a resume landing between the settle read and write causes a retry against the shifted deadline, and pausedAt stays cleared', async () => {
    // First read: still pending, due 11:00, paused at 10:10.
    const readAtStart: TicketSlaApplied = {
      policyId: 'sla_policy_1' as TicketSlaApplied['policyId'],
      policyName: 'P',
      appliedAt: '2026-01-05T10:00:00.000Z',
      timeToResolveDueAt: '2026-01-05T11:00:00.000Z',
      resolvedAt: null,
      pauseOnPending: true,
      pausedAt: '2026-01-05T10:10:00.000Z',
    }
    // Reload after the guard misses: a resume (paused 10:10 -> 10:40, 30min)
    // already landed, clearing pausedAt and shifting the due date to 11:30.
    const readAfterResume: TicketSlaApplied = {
      ...readAtStart,
      pausedAt: null,
      timeToResolveDueAt: '2026-01-05T11:30:00.000Z',
    }
    selectQueue = [[{ slaApplied: readAtStart }], [{ slaApplied: readAfterResume }]]
    // First guarded write misses (its predicate still expects pausedAt =
    // 10:10, but the row's pausedAt is already null post-resume). Second
    // write, guarded on the fresh (appliedAt, pausedAt: null), lands.
    updateQueue = [[], [{ id: ticketId }]]

    const settleAt = new Date('2026-01-05T11:20:00Z')
    await recordTicketResolution(ticketId, settleAt)

    expect(setCalls).toHaveLength(2) // one failed write, one that landed
    const finalWrite = setCalls[1] as { slaApplied: TicketSlaApplied }
    // The write that landed carries the fresh, resume-shifted state — not
    // the stale pausedAt/deadline the first (failed) attempt computed from.
    expect(finalWrite.slaApplied.pausedAt).toBeNull()
    expect(finalWrite.slaApplied.timeToResolveDueAt).toBe('2026-01-05T11:30:00.000Z')
    expect(finalWrite.slaApplied.resolvedAt).toBe(settleAt.toISOString())

    // Exactly one sla_events insert (the failed attempt logs nothing), and it
    // reflects the recomputed (shifted) due date: met at 11:20 against 11:30.
    expect(insertCalls).toHaveLength(1)
    const logged = insertCalls[0] as {
      kind: string
      ticketId: string
      conversationId: string | null
      meta: { dueAt: string }
    }
    expect(logged.kind).toBe('time_to_resolve_met')
    expect(logged.meta.dueAt).toBe('2026-01-05T11:30:00.000Z')
    expect(logged.ticketId).toBe(ticketId)
    expect(logged.conversationId).toBeNull()
  })

  it('a settle racing a concurrent settle leaves the newer resolvedAt instead of clobbering it', async () => {
    const readAtStart: TicketSlaApplied = {
      policyId: 'sla_policy_1' as TicketSlaApplied['policyId'],
      policyName: 'P',
      appliedAt: '2026-01-05T10:00:00.000Z',
      timeToResolveDueAt: '2026-01-05T11:00:00.000Z',
      resolvedAt: null,
      pauseOnPending: true,
      pausedAt: null,
    }
    // The guarded write misses: by the time it runs, someone else already
    // recorded the resolution (first resolution settles permanently).
    const readAfterRace: TicketSlaApplied = {
      ...readAtStart,
      resolvedAt: '2026-01-05T11:05:00.000Z',
    }
    selectQueue = [[{ slaApplied: readAtStart }], [{ slaApplied: readAfterRace }]]
    updateQueue = [[]] // the first write misses; no second write happens

    await recordTicketResolution(ticketId, new Date('2026-01-05T11:10:00Z'))

    // One write attempted and it missed; the reload sees resolvedAt already
    // set and returns without writing again — no second update, no clobber of
    // the newer resolvedAt, no duplicate settle event.
    expect(setCalls).toHaveLength(1)
    expect(insertCalls).toHaveLength(0)
  })
})
