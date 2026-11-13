/**
 * Two writers on one ticket: a recompute that starts while another
 * transaction holds the ticket and is adding a reply must wait for it, and
 * then see that reply. Without the lock taken first, the recompute works out
 * its value from what was committed when it started and writes a stale one.
 *
 * Real Postgres and real commits on two connections: the recompute runs on
 * the pool, and the other writer on a connection of its own.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createId, fromUuid, toUuid, type PrincipalId, type TicketId } from '@quackback/ids'
import { closeHarness } from '@/lib/server/jobs/__tests__/harness'

vi.mock('@/lib/server/db', async (importOriginal) => {
  const { testDb } = await import('@/lib/server/jobs/__tests__/harness')
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: new Proxy(
      {},
      {
        get(_t, prop) {
          const handle = testDb()
          const value = Reflect.get(handle as object, prop, handle)
          return typeof value === 'function' ? value.bind(handle) : value
        },
      }
    ),
  }
})

import { conversationMessages, principal, tickets } from '@/lib/server/db'
import {
  testDb,
  testSql,
  uniqueName,
  withOtherConnection,
} from '@/lib/server/backfills/__tests__/harness'
import { recomputeTicketFirstResponse } from '../ticket-first-response'

const titles: string[] = []
afterAll(async () => {
  for (const title of titles) {
    await testSql()`DELETE FROM conversation_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE title = ${title})`
    await testSql()`DELETE FROM tickets WHERE title = ${title}`
  }
  await closeHarness()
})

describe('a recompute that races a reply', () => {
  it('waits for the transaction holding the ticket, and counts the reply it committed', async () => {
    const title = uniqueName('frt-race')
    titles.push(title)
    const [status] = await testSql()<{ id: string }[]>`
      SELECT id::text FROM ticket_statuses WHERE deleted_at IS NULL ORDER BY position LIMIT 1
    `
    const customer = createId('principal') as PrincipalId
    const teammate = createId('principal') as PrincipalId
    await testDb()
      .insert(principal)
      .values([
        { id: customer, role: 'user', type: 'user', createdAt: new Date() },
        { id: teammate, role: 'member', type: 'user', createdAt: new Date() },
      ])
    const ticketId = createId('ticket') as TicketId
    await testDb()
      .insert(tickets)
      .values({ id: ticketId, title, statusId: fromUuid('ticket_status', status.id) })
    const askedAt = new Date(Date.now() - 3_600_000)
    const repliedAt = new Date(Date.now() - 1_800_000)
    await testDb().insert(conversationMessages).values({
      ticketId,
      principalId: customer,
      senderType: 'visitor',
      content: 'help',
      createdAt: askedAt,
    })

    let recompute: Promise<unknown> | null = null
    await withOtherConnection(async (other) => {
      await other.begin(async (tx) => {
        // The other writer holds the ticket, as a reply's transaction does.
        await tx`SELECT id FROM tickets WHERE id = ${toUuid(ticketId)}::uuid FOR UPDATE`
        await tx`
          INSERT INTO conversation_messages (id, ticket_id, principal_id, sender_type, content, created_at)
          VALUES (${toUuid(createId('conversation_message'))}::uuid, ${toUuid(ticketId)}::uuid,
                  ${toUuid(teammate)}::uuid, 'agent', 'on it', ${repliedAt.toISOString()})
        `
        // The recompute starts while the reply is uncommitted.
        recompute = recomputeTicketFirstResponse(ticketId)
        await new Promise((resolve) => setTimeout(resolve, 500))
      })
    })
    await recompute

    const [row] = await testSql()<{ at: number | null }[]>`
      SELECT (extract(epoch FROM first_response_at) * 1000)::float8 AS at
      FROM tickets WHERE id = ${toUuid(ticketId)}::uuid
    `
    expect(row.at).toBe(repliedAt.getTime())
  })
})
