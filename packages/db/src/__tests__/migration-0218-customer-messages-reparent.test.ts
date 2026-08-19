import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0218 — convergence Phase 6, literal convergence (scratchpad/convergence-design.md,
// open decision #1 flipped union-forever -> MIGRATE): re-parent every legacy
// customer-visible message still hanging off a LINKED customer ticket onto the
// pair's conversation, and backfill a backing conversation for every STANDALONE
// pre-1b customer ticket that has a requester (then re-parent its messages the
// same way). Internal notes, back-office/tracker rows, soft-deleted tickets,
// and the no-requester edge are untouched.
//
// Isolation mirrors migration-0084/0204: one transaction, assert, roll back so
// dev/test data is untouched — but unlike 0204 the statements run against the
// REAL tables (0218 is idempotent, so re-running it inside the tx only touches
// the fixtures seeded here; live rows are already migrated or get migrated
// in-tx and rolled back). The statements under test are read from the
// migration file itself, so this can never drift from what production runs.
//
// THE CRITICAL CORRECTNESS PROPERTY: the migration is READ-NEUTRAL. The
// pair-thread union loader merges both parents of a pair on (created_at, id),
// so moving a row from the ticket parent to the conversation parent of the
// SAME pair changes nothing the loader returns — the seeded interleaved pair's
// union output (ids + order) is asserted BYTE-IDENTICAL before and after.
const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../drizzle/0218_customer_messages_reparent_backfill.sql'),
  'utf8'
)
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean)

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** One row of the union-read merge: id + a numeric created_at for the comparator. */
interface UnionRow {
  id: string
  ts: number
}

describe.skipIf(!dbAvailable)('migration 0218 customer messages re-parent + backfill', () => {
  it('re-parents legacy rows, backfills standalone tickets, stays read-neutral + idempotent', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        const one = async <T>(q: ReturnType<typeof sql>): Promise<T> => {
          const rows = (await tx.execute(q)) as unknown as T[]
          return rows[0]
        }

        // ---------- fixtures ----------
        const pv = (
          await one<{ id: string }>(sql`
            INSERT INTO "principal" (id, display_name, role, type, created_at)
            VALUES (gen_random_uuid(), 'M0218 Visitor', 'user', 'user', now()) RETURNING id
          `)
        ).id
        const pv2 = (
          await one<{ id: string }>(sql`
            INSERT INTO "principal" (id, display_name, role, type, created_at)
            VALUES (gen_random_uuid(), 'M0218 Visitor2', 'user', 'user', now()) RETURNING id
          `)
        ).id
        const pa = (
          await one<{ id: string }>(sql`
            INSERT INTO "principal" (id, display_name, role, type, created_at)
            VALUES (gen_random_uuid(), 'M0218 Agent', 'member', 'user', now()) RETURNING id
          `)
        ).id
        const status = async (slug: string, category: 'open' | 'pending' | 'closed') =>
          (
            await one<{ id: string }>(sql`
              INSERT INTO "ticket_statuses" (id, name, slug, category)
              VALUES (gen_random_uuid(), ${`M0218 ${slug}`}, ${`${slug}-${suffix()}`}, ${category})
              RETURNING id
            `)
          ).id
        const stOpen = await status('m0218-open', 'open')
        const stPending = await status('m0218-pending', 'pending')
        const stClosed = await status('m0218-closed', 'closed')

        const ticket = async (opts: {
          title: string
          statusId: string
          type?: 'customer' | 'back_office'
          requester?: string | null
          assignee?: string | null
          priority?: string
          createdAt: string
          resolvedAt?: string | null
          deletedAt?: string | null
        }) =>
          (
            await one<{ id: string }>(sql`
              INSERT INTO "tickets" (
                id, title, status_id, type, requester_principal_id, assignee_principal_id,
                priority, created_at, resolved_at, deleted_at
              )
              VALUES (
                gen_random_uuid(), ${opts.title}, ${opts.statusId}::uuid, ${opts.type ?? 'customer'},
                ${opts.requester ?? null}::uuid, ${opts.assignee ?? null}::uuid,
                ${opts.priority ?? 'none'}, ${opts.createdAt}::timestamptz,
                ${opts.resolvedAt ?? null}::timestamptz, ${opts.deletedAt ?? null}::timestamptz
              )
              RETURNING id
            `)
          ).id
        const message = async (opts: {
          ticketId?: string | null
          conversationId?: string | null
          principalId?: string | null
          senderType: 'visitor' | 'agent'
          isInternal?: boolean
          createdAt: string
          deletedAt?: string | null
        }) =>
          (
            await one<{ id: string }>(sql`
              INSERT INTO "conversation_messages" (
                id, conversation_id, ticket_id, principal_id, sender_type, content,
                is_internal, created_at, deleted_at
              )
              VALUES (
                gen_random_uuid(), ${opts.conversationId ?? null}::uuid, ${opts.ticketId ?? null}::uuid,
                ${opts.principalId ?? null}::uuid, ${opts.senderType}, 'm0218',
                ${opts.isInternal ?? false}, ${opts.createdAt}::timestamptz,
                ${opts.deletedAt ?? null}::timestamptz
              )
              RETURNING id
            `)
          ).id

        // The linked pair with INTERLEAVED ticket/conversation rows (the
        // byte-identical fixture): conv, ticket, conv, ticket in time order,
        // plus an internal note and a soft-deleted legacy row on the ticket.
        const tPair = await ticket({
          title: 'M0218 pair ticket',
          statusId: stOpen,
          requester: pv,
          createdAt: '2026-01-01T00:00:00Z',
        })
        const cPair = (
          await one<{ id: string }>(sql`
            INSERT INTO "conversations" (id, visitor_principal_id, channel, created_at)
            VALUES (gen_random_uuid(), ${pv}::uuid, 'messenger', '2026-01-01T00:00:00Z'::timestamptz)
            RETURNING id
          `)
        ).id
        await tx.execute(sql`
          INSERT INTO "ticket_conversations" (ticket_id, conversation_id, ticket_type)
          VALUES (${tPair}::uuid, ${cPair}::uuid, 'customer')
        `)
        const m1 = await message({
          conversationId: cPair,
          principalId: pv,
          senderType: 'visitor',
          createdAt: '2026-01-01T01:00:00Z',
        })
        const m2 = await message({
          ticketId: tPair,
          principalId: pv,
          senderType: 'visitor',
          createdAt: '2026-01-01T02:00:00Z',
        })
        const m3 = await message({
          conversationId: cPair,
          principalId: pa,
          senderType: 'agent',
          createdAt: '2026-01-01T03:00:00Z',
        })
        const m4 = await message({
          ticketId: tPair,
          principalId: pv,
          senderType: 'visitor',
          createdAt: '2026-01-01T04:00:00Z',
        })
        const mNote = await message({
          ticketId: tPair,
          principalId: pa,
          senderType: 'agent',
          isInternal: true,
          createdAt: '2026-01-01T05:00:00Z',
        })
        const mDeleted = await message({
          ticketId: tPair,
          principalId: pv,
          senderType: 'visitor',
          createdAt: '2026-01-01T06:00:00Z',
          deletedAt: '2026-01-01T07:00:00Z',
        })

        // Standalone pre-1b customer tickets with a requester: backfilled.
        const tStand = await ticket({
          title: 'M0218 standalone ticket',
          statusId: stPending, // pending-category maps to conversation status 'open'
          requester: pv,
          assignee: pa,
          priority: 'high',
          createdAt: '2026-01-02T00:00:00Z',
        })
        const m7 = await message({
          ticketId: tStand,
          principalId: pv,
          senderType: 'visitor',
          createdAt: '2026-01-02T01:00:00Z',
        })
        const m8 = await message({
          ticketId: tStand,
          principalId: pa,
          senderType: 'agent',
          createdAt: '2026-01-02T02:00:00Z',
        })
        const tClosed = await ticket({
          title: 'M0218 closed ticket',
          statusId: stClosed, // closed-category maps to 'closed' + resolved_at carried
          requester: pv,
          createdAt: '2026-01-03T00:00:00Z',
          resolvedAt: '2026-01-03T03:00:00Z',
        })
        const m9 = await message({
          ticketId: tClosed,
          principalId: pv,
          senderType: 'visitor',
          createdAt: '2026-01-03T01:00:00Z',
        })
        const tEmpty = await ticket({
          title: 'M0218 empty ticket',
          statusId: stOpen,
          requester: pv2,
          createdAt: '2026-01-04T00:00:00Z',
        })

        // The untouched fixtures.
        const tNoReq = await ticket({
          title: 'M0218 no-requester ticket',
          statusId: stOpen,
          requester: null, // the designed exception: no visitor to mirror
          createdAt: '2026-01-05T00:00:00Z',
        })
        const tBackOffice = await ticket({
          title: 'M0218 back-office ticket',
          statusId: stOpen,
          type: 'back_office',
          createdAt: '2026-01-05T00:00:00Z',
        })
        const mBoVisible = await message({
          ticketId: tBackOffice,
          principalId: pa,
          senderType: 'agent',
          createdAt: '2026-01-05T01:00:00Z',
        })
        const mBoNote = await message({
          ticketId: tBackOffice,
          principalId: pa,
          senderType: 'agent',
          isInternal: true,
          createdAt: '2026-01-05T02:00:00Z',
        })
        const tDeleted = await ticket({
          title: 'M0218 soft-deleted ticket',
          statusId: stOpen,
          requester: pv,
          createdAt: '2026-01-05T00:00:00Z',
          deletedAt: '2026-01-06T00:00:00Z',
        })
        const mDelTicket = await message({
          ticketId: tDeleted,
          principalId: pv,
          senderType: 'visitor',
          createdAt: '2026-01-05T12:00:00Z',
        })

        // ---------- the union read, mirrored from pair-thread.service.ts ----------
        // (per-parent keyset read on (created_at, id), deleted + audience
        // filtered, merged in code on the same total order; `all: true` path).
        const unionRead = async (
          ticketId: string,
          conversationId: string | null,
          includeInternal: boolean
        ): Promise<string[]> => {
          const parents: { column: 'ticket_id' | 'conversation_id'; value: string }[] = [
            { column: 'ticket_id', value: ticketId },
            ...(conversationId
              ? [{ column: 'conversation_id' as const, value: conversationId }]
              : []),
          ]
          const merged: UnionRow[] = []
          for (const parent of parents) {
            const rows =
              parent.column === 'ticket_id'
                ? ((await tx.execute(sql`
                    SELECT id::text AS id, extract(epoch from created_at)::float8 AS ts
                    FROM "conversation_messages"
                    WHERE ticket_id = ${parent.value}::uuid
                      AND deleted_at IS NULL
                      AND (${includeInternal} OR is_internal = false)
                    ORDER BY created_at ASC, id ASC
                  `)) as unknown as UnionRow[])
                : ((await tx.execute(sql`
                    SELECT id::text AS id, extract(epoch from created_at)::float8 AS ts
                    FROM "conversation_messages"
                    WHERE conversation_id = ${parent.value}::uuid
                      AND deleted_at IS NULL
                      AND (${includeInternal} OR is_internal = false)
                    ORDER BY created_at ASC, id ASC
                  `)) as unknown as UnionRow[])
            merged.push(...rows)
          }
          // compareNewestFirst inverted to oldest-first (the loader's render order).
          merged.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          return merged.map((r) => r.id)
        }

        // BEFORE: the pair's union output, for both audiences.
        const beforeRequester = await unionRead(tPair, cPair, false)
        const beforeAgent = await unionRead(tPair, cPair, true)
        expect(beforeRequester).toEqual([m1, m2, m3, m4])
        expect(beforeAgent).toEqual([m1, m2, m3, m4, mNote])

        // ---------- run the migration (the file's own statements) ----------
        for (const stmt of MIGRATION_SQL) {
          await tx.execute(sql.raw(stmt))
        }

        // ---------- step 1: linked pair re-parented ----------
        const parentOf = async (id: string) =>
          one<{ conversation_id: string | null; ticket_id: string | null }>(sql`
            SELECT conversation_id::text, ticket_id::text FROM "conversation_messages" WHERE id = ${id}::uuid
          `)
        for (const legacy of [m2, m4, mDeleted]) {
          // deleted history moves too (mDeleted); the XOR swap is atomic.
          expect(await parentOf(legacy)).toEqual({ conversation_id: cPair, ticket_id: null })
        }
        // The internal note stays ticket-parented; conversation rows untouched.
        expect(await parentOf(mNote)).toEqual({ conversation_id: null, ticket_id: tPair })
        expect(await parentOf(m1)).toEqual({ conversation_id: cPair, ticket_id: null })

        // ---------- step 2: standalone tickets backfilled ----------
        const backfill = async (ticketId: string) =>
          one<{
            conversation_id: string
            linked_by: string | null
            link_matches_conv: boolean
            visitor: string
            agent: string | null
            status: string
            source: string
            channel: string
            priority: string
            subject: string
            created_matches: boolean
            last_message_matches: boolean
            resolved_at: string | null
            resolved_matches: boolean
          }>(sql`
            SELECT
              tc.conversation_id::text, tc.linked_by_principal_id::text AS linked_by,
              (tc.created_at = c.created_at) AS link_matches_conv,
              c.visitor_principal_id::text AS visitor,
              c.assigned_agent_principal_id::text AS agent,
              c.status, c.source, c.channel, c.priority, c.subject,
              (c.created_at = (SELECT created_at FROM "tickets" WHERE id = tc.ticket_id)) AS created_matches,
              (
                c.last_message_at = COALESCE(
                  (SELECT max(cm.created_at) FROM "conversation_messages" cm
                   WHERE cm.conversation_id = c.id AND cm.is_internal = false),
                  c.created_at
                )
              ) AS last_message_matches,
              c.resolved_at::text,
              (c.resolved_at IS NOT DISTINCT FROM (SELECT resolved_at FROM "tickets" WHERE id = tc.ticket_id)) AS resolved_matches
            FROM "ticket_conversations" tc
            JOIN "conversations" c ON c.id = tc.conversation_id
            WHERE tc.ticket_id = ${ticketId}::uuid AND tc.ticket_type = 'customer'
          `)
        const bStand = await backfill(tStand)
        expect(bStand.visitor).toBe(pv)
        expect(bStand.agent).toBe(pa)
        expect(bStand.status).toBe('open') // pending-category ticket -> open
        expect(bStand.source).toBe('web_form')
        expect(bStand.channel).toBe('web_form')
        expect(bStand.priority).toBe('high')
        expect(bStand.subject).toBe('M0218 standalone ticket')
        expect(bStand.linked_by).toBeNull()
        expect(bStand.created_matches).toBe(true) // conversation mirrors the ticket's birth
        expect(bStand.last_message_matches).toBe(true) // m8's stamp
        expect(bStand.resolved_at).toBeNull()
        expect(bStand.link_matches_conv).toBe(true) // born-linked
        expect(await parentOf(m7)).toEqual({
          conversation_id: bStand.conversation_id,
          ticket_id: null,
        })
        expect(await parentOf(m8)).toEqual({
          conversation_id: bStand.conversation_id,
          ticket_id: null,
        })

        const bClosed = await backfill(tClosed)
        expect(bClosed.status).toBe('closed') // closed-category ticket -> closed
        expect(bClosed.resolved_matches).toBe(true) // resolved_at carried over
        expect(bClosed.agent).toBeNull()
        expect(await parentOf(m9)).toEqual({
          conversation_id: bClosed.conversation_id,
          ticket_id: null,
        })

        // No messages: last_message_at falls back to the ticket's created_at
        // (last_message_matches — the COALESCE reduces to created_at).
        const bEmpty = await backfill(tEmpty)
        expect(bEmpty.status).toBe('open')
        expect(bEmpty.created_matches).toBe(true)
        expect(bEmpty.last_message_matches).toBe(true)

        // ---------- untouched: the no-requester edge, back-office, soft-deleted ----------
        const linksFor = async (ticketId: string) =>
          one<{ c: number }>(sql`
            SELECT count(*)::int AS c FROM "ticket_conversations" WHERE ticket_id = ${ticketId}::uuid
          `)
        expect((await linksFor(tNoReq)).c).toBe(0)
        expect((await linksFor(tBackOffice)).c).toBe(0)
        expect((await linksFor(tDeleted)).c).toBe(0)
        expect(await parentOf(mBoVisible)).toEqual({
          conversation_id: null,
          ticket_id: tBackOffice,
        })
        expect(await parentOf(mBoNote)).toEqual({ conversation_id: null, ticket_id: tBackOffice })
        expect(await parentOf(mDelTicket)).toEqual({ conversation_id: null, ticket_id: tDeleted })

        // Surface the no-requester standalone count (they keep reading via the
        // union loader forever — by design, nothing to migrate without a visitor).
        const noRequester = await one<{ c: number }>(sql`
          SELECT count(*)::int AS c
          FROM "tickets" t
          WHERE t.type = 'customer'
            AND t.requester_principal_id IS NULL
            AND t.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM "ticket_conversations" tc
              WHERE tc.ticket_id = t.id AND tc.ticket_type = 'customer'
            )
        `)
        console.log(
          `[0218] standalone customer tickets with no requester (left as-is): ${noRequester.c}`
        )

        // ---------- POST-CONDITION ----------
        // Zero customer-visible messages remain ticket-parented on customer
        // tickets IN THE MIGRATION'S DOMAIN (live, requester-holding tickets).
        // The two designed exceptions — soft-deleted standalone tickets (step 2
        // skips them) and the no-requester edge — legitimately retain rows: they
        // keep reading through the union loader forever, by design.
        const post = await one<{ c: number }>(sql`
          SELECT count(*)::int AS c
          FROM "conversation_messages" cm
          JOIN "tickets" t ON t.id = cm.ticket_id
          WHERE t.type = 'customer' AND cm.is_internal = false AND cm.ticket_id IS NOT NULL
            AND t.deleted_at IS NULL AND t.requester_principal_id IS NOT NULL
        `)
        expect(post.c).toBe(0)
        // The unscoped remainder is exactly the seeded soft-deleted ticket's row
        // (both dev databases carry no live exception rows — verified at ship
        // time; a future one failing this is a loud prompt to revisit, not a
        // silent pass).
        const remainder = await one<{ c: number }>(sql`
          SELECT count(*)::int AS c
          FROM "conversation_messages" cm
          JOIN "tickets" t ON t.id = cm.ticket_id
          WHERE t.type = 'customer' AND cm.is_internal = false AND cm.ticket_id IS NOT NULL
        `)
        expect(remainder.c).toBe(1)

        // ---------- READ-NEUTRAL: union output byte-identical before/after ----------
        expect(await unionRead(tPair, cPair, false)).toEqual(beforeRequester)
        expect(await unionRead(tPair, cPair, true)).toEqual(beforeAgent)
        // And the backfilled pair reads its whole thread through its new conversation.
        expect(await unionRead(tStand, bStand.conversation_id, false)).toEqual([m7, m8])

        // ---------- IDEMPOTENT: a second run re-parents 0, backfills 0 ----------
        const counts = async () => ({
          conversations: (
            await one<{ c: number }>(sql`
              SELECT count(*)::int AS c FROM "conversations" c
              JOIN "ticket_conversations" tc ON tc.conversation_id = c.id
              WHERE tc.ticket_id IN (${tStand}::uuid, ${tClosed}::uuid, ${tEmpty}::uuid)
            `)
          ).c,
          links: (
            await one<{ c: number }>(sql`
              SELECT count(*)::int AS c FROM "ticket_conversations"
              WHERE ticket_id IN (${tStand}::uuid, ${tClosed}::uuid, ${tEmpty}::uuid)
            `)
          ).c,
          ticketParentedVisible: (
            await one<{ c: number }>(sql`
              SELECT count(*)::int AS c FROM "conversation_messages"
              WHERE ticket_id IN (${tPair}::uuid, ${tStand}::uuid, ${tClosed}::uuid, ${tEmpty}::uuid)
                AND is_internal = false
            `)
          ).c,
        })
        const firstRun = await counts()
        expect(firstRun).toEqual({ conversations: 3, links: 3, ticketParentedVisible: 0 })
        for (const stmt of MIGRATION_SQL) {
          await tx.execute(sql.raw(stmt))
        }
        expect(await counts()).toEqual(firstRun)

        throw new Error('__ROLLBACK__') // abort the tx so dev/test data is untouched
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })
})
