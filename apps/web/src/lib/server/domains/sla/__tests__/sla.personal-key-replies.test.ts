/**
 * A personal API key acts as its creator, so a reply sent through the REST API
 * with one is that teammate's reply: it settles the first-response clock and
 * an armed next-response cycle, and opens no cycle of its own. A workspace
 * key's reply is automated: it settles nothing and opens a cycle. A legacy key
 * whose principal is a person settles like that person.
 *
 * Real DB (rolled back) and the real reaction, fed the event a REST reply
 * emits: its actor is the REST service actor (`serviceActorFromApiAuth`), and
 * its author is the key's principal.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  apiKeys,
  conversationMessages,
  conversations,
  principal,
  slaEvents,
  user,
  eq,
  type PermissionKey,
} from '@/lib/server/db'
import type { EventData } from '@/lib/server/events/types'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => ({ enabled: false, timezone: 'UTC', intervals: [] })),
}))

import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { createSlaPolicy } from '../sla-policy.service'
import { applySlaToConversation, type SlaApplied } from '../sla.service'
import { recordSlaFromEvent } from '../sla.event-hooks'
import { isAutomatedAuthor } from '@/lib/server/messages/reply-rule'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: apiKeys.id }).from(apiKeys).limit(0)
    await db.select({ id: slaEvents.id }).from(slaEvents).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const at = (hhmm: string) => new Date(`2026-01-05T${hhmm}:00.000Z`)
const iso = (hhmm: string) => at(hhmm).toISOString()

async function seedPerson(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

/** An API key and its service principal, as key creation writes them. */
async function seedKey(
  kind: 'personal' | 'workspace',
  opts: { createdById: PrincipalId | null; revoked?: boolean }
): Promise<PrincipalId> {
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: principalId, role: 'member', type: 'service', createdAt: new Date() })
  const hash = `${suffix()}${'0'.repeat(64)}`.slice(0, 64)
  await testDb.insert(apiKeys).values({
    name: `${kind} key`,
    keyHash: hash,
    keyPrefix: 'qb_test',
    createdById: opts.createdById,
    principalId,
    kind,
    revokedAt: opts.revoked ? new Date() : null,
  })
  return principalId
}

interface Thread {
  conversationId: ConversationId
  customer: PrincipalId
}

/** A conversation under a 1h first-response / 2h next-response policy, applied at 10:00. */
async function seedThread(): Promise<Thread> {
  const customer = await seedPerson()
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: customer, channel: 'messenger' })
    .returning()
  const conversationId = row.id as ConversationId
  const policy = await createSlaPolicy({
    name: `FR+NR ${suffix()}`,
    firstResponseTargetSecs: 3600,
    nextResponseTargetSecs: 2 * 3600,
  })
  await applySlaToConversation(conversationId, policy.id, at('10:00'))
  return { conversationId, customer }
}

/** The REST actor a key's request runs as. */
function restActor(keyPrincipal: PrincipalId): Actor {
  return serviceActorFromApiAuth({
    principalId: keyPrincipal,
    role: 'member',
    permissions: new Set<PermissionKey>(),
  })
}

/**
 * Write a message at `hhmm` and return the `message.created` its reaction
 * reads. `actor` is the request's actor; the event carries it the way the
 * conversation webhooks do.
 */
async function write(
  thread: Thread,
  senderType: 'visitor' | 'agent',
  hhmm: string,
  author: PrincipalId,
  actor?: Actor
): Promise<EventData> {
  const [row] = await testDb
    .insert(conversationMessages)
    .values({
      conversationId: thread.conversationId,
      principalId: author,
      senderType,
      content: `${senderType} at ${hhmm}`,
      createdAt: at(hhmm),
    })
    .returning()
  return {
    type: 'message.created',
    id: createId('event'),
    timestamp: new Date().toISOString(),
    actor: {
      type: actor?.principalType === 'service' ? 'service' : 'user',
      principalId: actor?.principalId ?? author,
    },
    data: {
      message: {
        id: row.id,
        conversationId: thread.conversationId,
        senderType,
        authorPrincipalId: author,
        authorName: senderType,
        authorEmail: null,
        content: row.content,
        createdAt: at(hhmm).toISOString(),
      },
      conversation: {
        id: thread.conversationId,
        status: 'open',
        channel: 'messenger',
        priority: 'medium',
        assignedTeamId: null,
      },
      isFirstMessage: false,
    },
  } as unknown as EventData
}

async function stampOf(conversationId: ConversationId): Promise<SlaApplied> {
  const [row] = await testDb
    .select({ slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  return row.slaApplied as SlaApplied
}

describe.skipIf(!fixture.available)('SLA clocks and API key replies', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  for (const [label, opts] of [
    ['a personal key', { revoked: false }],
    ['a revoked personal key whose creator is gone', { revoked: true, orphan: true }],
  ] as const) {
    it(`${label}: its reply settles first response, then an armed cycle, and opens none`, async () => {
      const thread = await seedThread()
      const creator = await seedPerson()
      const key = await seedKey('personal', {
        createdById: 'orphan' in opts ? null : creator,
        revoked: opts.revoked,
      })
      await recordSlaFromEvent(await write(thread, 'visitor', '10:05', thread.customer))

      await recordSlaFromEvent(await write(thread, 'agent', '10:30', key, restActor(key)))
      expect((await stampOf(thread.conversationId)).firstResponseAt).toBe(iso('10:30'))

      // The customer writes again; the key's next reply answers that cycle.
      await recordSlaFromEvent(await write(thread, 'visitor', '10:40', thread.customer))
      expect(await stampOf(thread.conversationId)).toMatchObject({
        nextResponseDueAt: iso('12:40'),
        nextResponseAt: null,
      })
      await recordSlaFromEvent(await write(thread, 'agent', '11:00', key, restActor(key)))
      expect(await stampOf(thread.conversationId)).toMatchObject({
        nextResponseDueAt: iso('12:40'),
        nextResponseAt: iso('11:00'),
      })
    })
  }

  it("a workspace key's reply settles no clock and opens a next-response cycle", async () => {
    const thread = await seedThread()
    const teammate = await seedPerson()
    const key = await seedKey('workspace', { createdById: teammate })
    await recordSlaFromEvent(await write(thread, 'visitor', '10:05', thread.customer))
    await recordSlaFromEvent(await write(thread, 'agent', '10:30', teammate))

    await recordSlaFromEvent(await write(thread, 'agent', '10:45', key, restActor(key)))
    const stamp = await stampOf(thread.conversationId)
    expect(stamp.firstResponseAt).toBe(iso('10:30'))
    // The automated reply opened a cycle the teammate has not answered.
    expect(stamp).toMatchObject({ nextResponseDueAt: iso('12:45'), nextResponseAt: null })
  })

  it("a workspace key's reply never settles the first response", async () => {
    const thread = await seedThread()
    const key = await seedKey('workspace', { createdById: null })
    await recordSlaFromEvent(await write(thread, 'visitor', '10:05', thread.customer))
    await recordSlaFromEvent(await write(thread, 'agent', '10:30', key, restActor(key)))
    expect((await stampOf(thread.conversationId)).firstResponseAt ?? null).toBeNull()
  })

  it('a legacy key whose principal is a person settles first response from its own event', async () => {
    const thread = await seedThread()
    const person = await seedPerson()
    await recordSlaFromEvent(await write(thread, 'visitor', '10:05', thread.customer))
    await recordSlaFromEvent(await write(thread, 'agent', '10:20', person, restActor(person)))
    expect((await stampOf(thread.conversationId)).firstResponseAt).toBe(iso('10:20'))
  })

  it('an open cycle that an older personal-key reply opened is settled by it once the cycles are rebuilt', async () => {
    const thread = await seedThread()
    const teammate = await seedPerson()
    const key = await seedKey('personal', { createdById: teammate })
    await recordSlaFromEvent(await write(thread, 'visitor', '10:05', thread.customer))
    await recordSlaFromEvent(await write(thread, 'agent', '10:30', teammate))
    await recordSlaFromEvent(await write(thread, 'visitor', '10:40', thread.customer))
    // The key's reply row is already stored; the next customer message's
    // reaction rebuilds the cycles from the rows, and the reply answers the
    // 10:40 cycle rather than opening one.
    await write(thread, 'agent', '11:00', key, restActor(key))
    await recordSlaFromEvent(await write(thread, 'visitor', '11:30', thread.customer))

    expect(await stampOf(thread.conversationId)).toMatchObject({
      nextResponseDueAt: iso('13:30'),
      nextResponseAt: null,
    })
    const settled = (
      await testDb
        .select()
        .from(slaEvents)
        .where(eq(slaEvents.conversationId, thread.conversationId))
    ).filter((event) => event.kind === 'next_response_met')
    expect(settled.map((event) => event.meta.at)).toEqual([iso('11:00')])
  })

  it("reads the author only for a service actor's message", async () => {
    const workspaceKey = await seedKey('workspace', { createdById: null })
    const personalKey = await seedKey('personal', { createdById: null })
    expect(await isAutomatedAuthor(workspaceKey, 'service')).toBe(true)
    expect(await isAutomatedAuthor(personalKey, 'service')).toBe(false)
    // A person's message is never automated, whoever the principal is.
    expect(await isAutomatedAuthor(workspaceKey, 'user')).toBe(false)
    expect(await isAutomatedAuthor(null, 'service')).toBe(false)
  })
})
