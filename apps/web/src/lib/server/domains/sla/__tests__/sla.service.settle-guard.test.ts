/**
 * Mocked-db coverage for the settle-write CAS guard (support platform §4.6):
 * commitClockEvent (used by recordFirstResponse/recordResolution) must be
 * guarded on `(appliedAt, pausedAt)` the same way pause/resume already are,
 * and retry exactly once against a freshly-reloaded stamp when that guard
 * misses. This can't be exercised against the real-DB fixture (a single
 * transaction/connection can't produce a genuine concurrent interleaving), so
 * `db` is fully mocked here to script the two reads and (up to) two guarded
 * writes each test needs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'

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

import { recordFirstResponse, recordResolution, type SlaApplied } from '../sla.service'

const conversationId = 'conversation_1' as ConversationId

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue = []
  updateQueue = []
  setCalls.length = 0
  insertCalls.length = 0
})

describe('settle-vs-resume interleaving', () => {
  it('a resume landing between the settle read and write causes a retry against the shifted deadline, and pausedAt stays cleared', async () => {
    // First read: still snoozed, due 11:00, paused at 10:10.
    const readAtStart: SlaApplied = {
      policyId: 'policy_1' as SlaApplied['policyId'],
      policyName: 'P',
      appliedAt: '2026-01-05T10:00:00.000Z',
      firstResponseDueAt: '2026-01-05T11:00:00.000Z',
      nextResponseTargetSecs: null,
      timeToCloseDueAt: null,
      firstResponseAt: null,
      pauseOnSnooze: true,
      pausedAt: '2026-01-05T10:10:00.000Z',
    }
    // Reload after the guard misses: a resume (paused 10:10 -> 10:40, 30min)
    // already landed, clearing pausedAt and shifting the due date to 11:30.
    const readAfterResume: SlaApplied = {
      ...readAtStart,
      pausedAt: null,
      firstResponseDueAt: '2026-01-05T11:30:00.000Z',
    }
    selectQueue = [[{ slaApplied: readAtStart }], [{ slaApplied: readAfterResume }]]
    // First guarded write misses (its predicate still expects pausedAt =
    // 10:10, but the row's pausedAt is already null post-resume). Second
    // write, guarded on the fresh (appliedAt, pausedAt: null), lands.
    updateQueue = [[], [{ id: conversationId }]]

    const settleAt = new Date('2026-01-05T11:20:00Z')
    await recordFirstResponse(conversationId, settleAt)

    expect(setCalls).toHaveLength(2) // one failed write, one that landed
    const finalWrite = setCalls[1] as { slaApplied: SlaApplied }
    // The write that landed carries the fresh, resume-shifted state — not
    // the stale pausedAt/deadline the first (failed) attempt computed from.
    expect(finalWrite.slaApplied.pausedAt).toBeNull()
    expect(finalWrite.slaApplied.firstResponseDueAt).toBe('2026-01-05T11:30:00.000Z')
    expect(finalWrite.slaApplied.firstResponseAt).toBe(settleAt.toISOString())

    // Exactly one sla_events insert (the failed attempt logs nothing), and it
    // reflects the recomputed (shifted) due date: met at 11:20 against 11:30.
    expect(insertCalls).toHaveLength(1)
    const logged = insertCalls[0] as { kind: string; meta: { dueAt: string } }
    expect(logged.kind).toBe('first_response_met')
    expect(logged.meta.dueAt).toBe('2026-01-05T11:30:00.000Z')
  })

  it('preloaded-stale case degrades to a reload instead of clobbering a newer resolvedAt', async () => {
    const preloaded: SlaApplied = {
      policyId: 'policy_1' as SlaApplied['policyId'],
      policyName: 'P',
      appliedAt: '2026-01-05T10:00:00.000Z',
      firstResponseDueAt: null,
      nextResponseTargetSecs: null,
      timeToCloseDueAt: '2026-01-05T14:00:00.000Z',
      resolvedAt: null,
      pauseOnSnooze: true,
      pausedAt: null,
    }
    // The preloaded stamp is stale: by the time this function's guarded write
    // runs, someone else already recorded the resolution.
    const readAfterRace: SlaApplied = {
      ...preloaded,
      resolvedAt: '2026-01-05T14:05:00.000Z',
    }
    selectQueue = [[{ slaApplied: readAfterRace }]] // only the post-miss reload reads
    updateQueue = [[]] // the preloaded-guard write misses

    await recordResolution(conversationId, new Date('2026-01-05T14:10:00Z'), preloaded)

    // One write attempted (using the stale preloaded guard) and it missed;
    // the reload sees resolvedAt already set and returns without writing
    // again — no second update, no clobber of the newer resolvedAt.
    expect(setCalls).toHaveLength(1)
    expect(insertCalls).toHaveLength(0)
  })
})
