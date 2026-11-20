/**
 * Every per-minute schedule is gated.
 *
 * On a pooled fleet a schedule runs in every awake workspace. An ungated
 * `* * * * *` job is an enqueue, a claim and a run in each of them every minute,
 * whether or not the workspace has anything for it to do. `deadlines.ts` is the
 * mechanism that lets a per-minute schedule tick only when it has work.
 *
 * The two support sweeps register their real deadline providers on import;
 * the cases below answer each provider's one query with a canned row, so they
 * pin what the gate makes of it (JOB-09, JOB-15) without a database.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JOB_DEFINITIONS } from '../definitions'
import { isSnoozeSweepDue } from '@/lib/server/domains/conversation/snooze-sweep-queue'
import { isSlaBreachSweepDue } from '@/lib/server/domains/sla/sla-breach-sweep-queue'

const execute = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { execute },
}))

describe('the job registry', () => {
  it('gives every per-minute schedule a gate', () => {
    const ungated = JOB_DEFINITIONS.filter(
      (def) => def.cron === '* * * * *' && !def.cronEnabled
    ).map((def) => def.name)
    expect(ungated).toEqual([])
  })
})

/** Answer the provider's single `db.execute` with one row. */
function answerDeadline(dueAt: string | Date | null) {
  execute.mockResolvedValue([{ due_at: dueAt }])
}

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000)

describe('the support sweep gates', () => {
  afterEach(() => execute.mockReset())

  it('JOB-09 keeps the snooze sweep inert with nothing snoozed, and opens it for a due timer', async () => {
    answerDeadline(null)
    expect(await isSnoozeSweepDue()).toBe(false)

    answerDeadline(inMinutes(10))
    expect(await isSnoozeSweepDue()).toBe(false)

    answerDeadline(inMinutes(-1))
    expect(await isSnoozeSweepDue()).toBe(true)
  })

  it('JOB-15 keeps the SLA sweep inert without a running clock; an unparsable due value counts as due', async () => {
    answerDeadline(null)
    expect(await isSlaBreachSweepDue()).toBe(false)

    answerDeadline(inMinutes(10).toISOString())
    expect(await isSlaBreachSweepDue()).toBe(false)

    answerDeadline(inMinutes(-1).toISOString())
    expect(await isSlaBreachSweepDue()).toBe(true)

    // A due value that is not a date must never silence the sweep.
    answerDeadline('not-a-date')
    expect(await isSlaBreachSweepDue()).toBe(true)
  })
})
