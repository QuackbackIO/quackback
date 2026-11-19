/**
 * TKT-12: createTicket's refusals, against a real database: a blank or
 * over-long title, a ticket type that does not exist, a type whose category
 * contradicts an explicit `type`, and a workspace with no default status.
 * Each refusal writes no ticket.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type TicketTypeId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  user,
  principal,
  tickets,
  ticketStatuses,
  ticketTypes,
  settings,
  eq,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createTicket } from '../ticket.service'

const fixture = await createDbTestFixture()
let actor: Actor

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  expect(process.env.DATABASE_URL).toMatch(/\/quackback_test(?:_\w+)?(?:\?|$)/)
  await fixture.begin()
  const ownerUser = createId('user')
  const owner: PrincipalId = createId('principal')
  await testDb
    .insert(user)
    .values({ id: ownerUser, name: 'Acme', email: `you+${ownerUser}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: owner, userId: ownerUser, type: 'user', role: 'admin', createdAt: new Date() })
  actor = {
    principalId: owner,
    principalType: 'user',
    role: 'admin',
    permissions: new Set([PERMISSIONS.TICKET_CREATE, PERMISSIONS.TICKET_VIEW_ALL]),
    segmentIds: new Set(),
  }
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${createId('workspace')}`, createdAt: new Date() })
  // One default status of our own, so the happy path below can create.
  await testDb.update(ticketStatuses).set({ isDefault: false })
  await testDb
    .insert(ticketStatuses)
    .values({ name: 'Acme new', slug: createId('ticket_status'), isDefault: true })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function ticketCount(title: string): Promise<number> {
  return (await testDb.select().from(tickets).where(eq(tickets.title, title))).length
}

it('refuses a blank title', async () => {
  await expect(createTicket({ title: '   ', type: 'back_office' }, actor)).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
    message: 'Title is required',
  })
})

it('refuses a title over 300 characters', async () => {
  const title = 'x'.repeat(301)
  await expect(createTicket({ title, type: 'back_office' }, actor)).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
    message: 'Title must be 300 characters or less',
  })
  expect(await ticketCount(title)).toBe(0)
})

it('refuses a ticket type that does not exist', async () => {
  const title = 'Unknown type'
  await expect(
    createTicket({ title, ticketTypeId: createId('ticket_type') as TicketTypeId }, actor)
  ).rejects.toMatchObject({ code: 'TICKET_TYPE_NOT_FOUND' })
  expect(await ticketCount(title)).toBe(0)
})

it('refuses a type whose category contradicts the explicit type', async () => {
  const [type] = await testDb
    .insert(ticketTypes)
    .values({ name: 'Refund ledger', slug: `refund_${Date.now()}`, category: 'back_office' })
    .returning()
  const title = 'Mismatched category'
  await expect(
    createTicket({ title, type: 'customer', ticketTypeId: type.id as TicketTypeId }, actor)
  ).rejects.toMatchObject({
    code: 'TICKET_TYPE_CATEGORY_MISMATCH',
    message: "Ticket type 'Refund ledger' belongs to category 'back_office', not 'customer'",
  })
  expect(await ticketCount(title)).toBe(0)
})

it('refuses when no default status is configured', async () => {
  await testDb.update(ticketStatuses).set({ isDefault: false })
  const title = 'No default status'
  await expect(createTicket({ title, type: 'back_office' }, actor)).rejects.toMatchObject({
    code: 'NO_DEFAULT_STATUS',
  })
  expect(await ticketCount(title)).toBe(0)
})

it('creates the ticket once the input is valid (control)', async () => {
  const ticket = await createTicket({ title: 'Valid ticket', type: 'back_office' }, actor)
  expect(ticket.title).toBe('Valid ticket')
  expect(ticket.status.name).toBe('Acme new')
  expect(await ticketCount('Valid ticket')).toBe(1)
})
