/**
 * Target resolution for the added-as-watcher bell (ticket.subscriber_added):
 * the person a teammate (or a workflow) added hears about it, once, named by
 * who added them; nobody is belled for their own watch; and the bell stays on
 * the team.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '../types'

// --- db: the subscriber's principal row, queued per test ---
const principalRows: unknown[][] = []
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => {
      const rows = principalRows.shift() ?? []
      const chain: Record<string, unknown> = {}
      for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'orderBy']) {
        chain[m] = () => chain
      }
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(res, rej)
      return chain
    },
  },
}))

const { getTicketSubscriberAddedTargets } = await import('../targets')

beforeEach(() => {
  principalRows.length = 0
})

function addedEvent(
  actor: EventData['actor'],
  subscriberPrincipalId = 'principal_mate'
): EventData {
  return {
    id: 'evt-1',
    type: 'ticket.subscriber_added',
    timestamp: '2026-01-01T00:00:00Z',
    actor,
    data: {
      ticket: { id: 'ticket_1', number: 7, type: 'customer', priority: 'none' },
      title: 'Refund not received',
      subscriberPrincipalId,
      reason: 'manual',
    },
  } as EventData
}

describe('getTicketSubscriberAddedTargets', () => {
  it('bells the teammate someone else added, naming who added them', async () => {
    principalRows.push([{ type: 'user', role: 'member' }])
    const target = await getTicketSubscriberAddedTargets(
      addedEvent({ type: 'user', principalId: 'principal_lead', displayName: 'Lea' })
    )
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_mate'] },
      config: { ticketId: 'ticket_1', title: 'Refund not received', authorName: 'Lea' },
    })
  })

  it('reads who added them from their principal, as the relayed event carries no name', async () => {
    principalRows.push([{ type: 'user', role: 'member' }], [{ displayName: 'Lea' }])
    const target = await getTicketSubscriberAddedTargets(
      addedEvent({ type: 'user', principalId: 'principal_lead' })
    )
    expect(target?.config).toMatchObject({ authorName: 'Lea' })
  })

  it('falls back to "A teammate" for a principal with no name', async () => {
    principalRows.push([{ type: 'user', role: 'member' }], [{ displayName: null }])
    const target = await getTicketSubscriberAddedTargets(
      addedEvent({ type: 'user', principalId: 'principal_lead' })
    )
    expect(target?.config).toMatchObject({ authorName: 'A teammate' })
  })

  it('names a workflow add as an automation', async () => {
    principalRows.push([{ type: 'user', role: 'admin' }])
    const target = await getTicketSubscriberAddedTargets(addedEvent({ type: 'service' }))
    expect(target?.config).toMatchObject({ authorName: 'An automation' })
  })

  it('bells nobody for their own watch', async () => {
    expect(
      await getTicketSubscriberAddedTargets(
        addedEvent({ type: 'user', principalId: 'principal_mate' })
      )
    ).toBeNull()
  })

  it('keeps the bell on the team', async () => {
    principalRows.push([{ type: 'user', role: 'user' }])
    expect(
      await getTicketSubscriberAddedTargets(
        addedEvent({ type: 'user', principalId: 'principal_lead' })
      )
    ).toBeNull()
  })
})
