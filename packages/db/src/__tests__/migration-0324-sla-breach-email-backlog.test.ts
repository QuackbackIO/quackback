import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0324 marks SLA clocks that are already past due as emailed, once per
// database, so the first sweep after the upgrade does not email a backlog of
// old breaches. Clocks still running, paused or settled are left alone, and a
// second run (a ledger replay) never marks a breach that happened afterwards.
// The tables are copied into a private schema inside a rolled-back
// transaction, so the migration sees only this test's rows.
const MIGRATION = readFileSync(
  join(__dirname, '../../drizzle/0324_sla_breach_email_backlog.sql'),
  'utf8'
)

const DB_URL = process.env.DATABASE_URL
const db: Database | null = DB_URL ? createDb(DB_URL, { max: 1 }) : null

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

const HOUR = 60 * 60_000
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

/** Conversation stamps by name: what each clock looks like before the upgrade. */
const CONVERSATIONS: Record<string, Record<string, unknown>> = {
  // First response overdue, resolution still running.
  overdue: {
    appliedAt: iso(-5 * HOUR),
    firstResponseDueAt: iso(-2 * HOUR),
    timeToCloseDueAt: iso(20 * HOUR),
  },
  // Next response overdue after the first was answered.
  nextOverdue: {
    appliedAt: iso(-30 * HOUR),
    firstResponseDueAt: iso(-29 * HOUR),
    firstResponseAt: iso(-29.5 * HOUR),
    nextResponseDueAt: iso(-1 * HOUR),
    timeToCloseDueAt: iso(-3 * HOUR),
  },
  // Answered in time and resolved: nothing to mark.
  settled: {
    appliedAt: iso(-5 * HOUR),
    firstResponseDueAt: iso(-2 * HOUR),
    firstResponseAt: iso(-3 * HOUR),
    timeToCloseDueAt: iso(-1 * HOUR),
    resolvedAt: iso(-1.5 * HOUR),
  },
  // Paused: its deadline moves when it resumes, and it emails then.
  paused: {
    appliedAt: iso(-5 * HOUR),
    firstResponseDueAt: iso(-2 * HOUR),
    pausedAt: iso(-3 * HOUR),
  },
  // Already emailed by a live workflow before the upgrade: keeps its time.
  alreadyFired: {
    appliedAt: iso(-5 * HOUR),
    firstResponseDueAt: iso(-2 * HOUR),
    firstResponseBreachTriggerFiredAt: '2026-01-01T00:00:00.000Z',
  },
}

describe.skipIf(!db)('migration 0324 marks the SLA breach backlog as emailed', () => {
  it('marks only running clocks already past due, on conversations and tickets, and replays as a no-op', async () => {
    await db!
      .transaction(async (tx) => {
        const schema = `m0324_${Date.now().toString(36)}`
        await tx.execute(sql.raw(`CREATE SCHEMA ${schema}`))
        for (const table of ['conversations', 'tickets'])
          await tx.execute(
            sql.raw(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`)
          )
        // LIKE ... INCLUDING ALL copies column comments, and the comment is the
        // migration's marker: start from a database that has not run it.
        await tx.execute(sql.raw(`COMMENT ON COLUMN ${schema}.conversations.sla_applied IS NULL`))
        await tx.execute(sql.raw(`SET LOCAL search_path = ${schema}, public`))

        const addConversation = (name: string, applied: Record<string, unknown> | null) =>
          tx.execute(sql`
          INSERT INTO "conversations" (id, visitor_principal_id, channel, subject, sla_applied)
          VALUES (gen_random_uuid(), gen_random_uuid(), 'chat', ${name}, ${applied ? JSON.stringify(applied) : null}::jsonb)
        `)
        const addTicket = (title: string, applied: Record<string, unknown>) =>
          tx.execute(sql`
          INSERT INTO "tickets" (id, title, status_id, sla_applied)
          VALUES (gen_random_uuid(), ${title}, gen_random_uuid(), ${JSON.stringify(applied)}::jsonb)
        `)
        for (const [name, applied] of Object.entries(CONVERSATIONS))
          await addConversation(name, applied)
        await addConversation('noSla', null)
        await addTicket('ticketOverdue', {
          appliedAt: iso(-9 * HOUR),
          timeToResolveDueAt: iso(-1 * HOUR),
        })
        await addTicket('ticketRunning', {
          appliedAt: iso(-1 * HOUR),
          timeToResolveDueAt: iso(5 * HOUR),
        })

        type Stamp = Record<string, string | undefined> | null
        const conversationStamps = async () =>
          Object.fromEntries(
            (
              (await tx.execute(
                sql`SELECT subject, sla_applied FROM "conversations"`
              )) as unknown as { subject: string; sla_applied: Stamp }[]
            ).map((row) => [row.subject, row.sla_applied])
          )
        const ticketStamps = async () =>
          Object.fromEntries(
            (
              (await tx.execute(sql`SELECT title, sla_applied FROM "tickets"`)) as unknown as {
                title: string
                sla_applied: Stamp
              }[]
            ).map((row) => [row.title, row.sla_applied])
          )

        await tx.execute(sql.raw(MIGRATION))
        const after = await conversationStamps()
        const tickets = await ticketStamps()

        // Overdue running clocks are marked; the running resolution clock is not.
        expect(after.overdue?.firstResponseBreachTriggerFiredAt).toEqual(expect.any(String))
        expect(after.overdue?.resolutionBreachTriggerFiredAt).toBeUndefined()
        expect(after.nextOverdue?.nextResponseBreachTriggerFiredAt).toEqual(expect.any(String))
        expect(after.nextOverdue?.resolutionBreachTriggerFiredAt).toEqual(expect.any(String))
        // The first-response clock settled, so it is left alone.
        expect(after.nextOverdue?.firstResponseBreachTriggerFiredAt).toBeUndefined()
        // The rest of the stamp is untouched.
        expect(after.overdue?.firstResponseDueAt).toBe(CONVERSATIONS.overdue.firstResponseDueAt)
        expect(after.settled).toEqual(CONVERSATIONS.settled)
        expect(after.paused).toEqual(CONVERSATIONS.paused)
        expect(after.alreadyFired).toEqual(CONVERSATIONS.alreadyFired)
        expect(after.noSla).toBeNull()
        expect(tickets.ticketOverdue?.resolutionBreachTriggerFiredAt).toEqual(expect.any(String))
        expect(tickets.ticketRunning?.resolutionBreachTriggerFiredAt).toBeUndefined()

        // A breach after the upgrade: the running clocks pass their deadlines.
        await tx.execute(sql`
          UPDATE "conversations"
          SET sla_applied = sla_applied || jsonb_build_object('timeToCloseDueAt', ${iso(-1000)}::text)
          WHERE subject = 'overdue'
        `)
        await tx.execute(sql`
          UPDATE "tickets"
          SET sla_applied = sla_applied || jsonb_build_object('timeToResolveDueAt', ${iso(-1000)}::text)
          WHERE title = 'ticketRunning'
        `)
        await addConversation('later', {
          appliedAt: iso(-2 * HOUR),
          firstResponseDueAt: iso(-1000),
        })
        const before = { conversations: await conversationStamps(), tickets: await ticketStamps() }

        // A replay marks none of them: they are breaches the sweep should email.
        await tx.execute(sql.raw(MIGRATION))
        expect({
          conversations: await conversationStamps(),
          tickets: await ticketStamps(),
        }).toEqual(before)
        expect(before.conversations.overdue?.resolutionBreachTriggerFiredAt).toBeUndefined()
        expect(before.conversations.later?.firstResponseBreachTriggerFiredAt).toBeUndefined()
        expect(before.tickets.ticketRunning?.resolutionBreachTriggerFiredAt).toBeUndefined()

        throw new Error('__ROLLBACK__')
      })
      .catch((error) => {
        if (!(error instanceof Error) || error.message !== '__ROLLBACK__') throw error
      })
  })
})
