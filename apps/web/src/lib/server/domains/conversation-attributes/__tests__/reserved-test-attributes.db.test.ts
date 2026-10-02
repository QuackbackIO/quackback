import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  conversationAttributeDefinitions,
  conversations,
  eq,
  isTestRecord,
  principal,
  tickets,
  ticketStatuses,
} from '@/lib/server/db'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { createConversationAttribute } from '../conversation-attribute.service'
import { setConversationAttribute } from '../set-attribute.service'
import { ATTRIBUTE_SOURCES } from '@/lib/shared/conversation/attribute-values'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { dispatchChanged } = vi.hoisted(() => ({
  dispatchChanged: vi.fn(async (actor, conversation, key, value, source) => {
    expect(actor.type).toEqual(expect.any(String))
    expect(conversation.id).toEqual(expect.any(String))
    expect(key).toEqual(expect.any(String))
    expect(value === null || ['string', 'number', 'boolean', 'object'].includes(typeof value)).toBe(
      true
    )
    expect(['teammate', 'workflow', 'ai', 'customer']).toContain(source)
  }),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchConversationAttributeChanged: dispatchChanged,
}))

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ key: conversationAttributeDefinitions.key })
      .from(conversationAttributeDefinitions)
      .limit(0)
  },
})
const MARKER_KEYS = ['test', 'onboardingGenerated', 'testOwnerPrincipalId'] as const
const targets = ['conversation', 'ticket'] as const

async function seedTarget(kind: (typeof targets)[number], marked: boolean) {
  const [owner] = await testDb
    .insert(principal)
    .values({ type: 'user', role: 'admin', createdAt: new Date() })
    .returning()
  const attributes = marked
    ? { test: true, onboardingGenerated: 'true', testOwnerPrincipalId: owner.id, note: 'Acme' }
    : { note: 'Acme' }
  if (kind === 'conversation') {
    const [visitor] = await testDb
      .insert(principal)
      .values({ type: 'anonymous', role: 'user', createdAt: new Date() })
      .returning()
    const [row] = await testDb
      .insert(conversations)
      .values({
        visitorPrincipalId: visitor.id,
        channel: 'messenger',
        customAttributes: attributes,
      })
      .returning()
    return { target: { conversationId: row.id }, attributes, ownerId: owner.id }
  }
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Open', slug: `acme-${owner.id}` })
    .returning()
  const [row] = await testDb
    .insert(tickets)
    .values({ title: 'Acme', statusId: status.id, customAttributes: attributes })
    .returning()
  return { target: { ticketId: row.id }, attributes, ownerId: owner.id }
}

async function readAttributes(target: Parameters<typeof setConversationAttribute>[0]) {
  if ('conversationId' in target) {
    const [row] = await testDb
      .select({ attributes: conversations.customAttributes })
      .from(conversations)
      .where(eq(conversations.id, target.conversationId))
    return row.attributes
  }
  const [row] = await testDb
    .select({ attributes: tickets.customAttributes })
    .from(tickets)
    .where(eq(tickets.id, target.ticketId))
  return row.attributes
}

describe.skipIf(!fixture.available)('server-owned test attribute keys (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    dispatchChanged.mockClear()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it.each([
    'test',
    ' TEST ',
    'onboardingGenerated',
    ' ONBOARDINGGENERATED ',
    'testOwnerPrincipalId',
    ' TestOwnerPrincipalId ',
  ])('refuses a definition for %s before inserting', async (key) => {
    await expect(
      createConversationAttribute({ key, label: 'Acme', fieldType: 'text' })
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_RESERVED' })
    const normalized = key.trim().toLowerCase()
    expect(
      await testDb.query.conversationAttributeDefinitions.findFirst({
        where: eq(conversationAttributeDefinitions.key, normalized),
      })
    ).toBeUndefined()
  })

  for (const kind of targets) {
    for (const key of MARKER_KEYS) {
      for (const source of ATTRIBUTE_SOURCES) {
        it.each(['overwrite', 'unset', 'forge'] as const)(
          `${kind} ${source} cannot %s ${key}, including a legacy definition`,
          async (operation) => {
            await testDb.insert(conversationAttributeDefinitions).values({
              key,
              label: 'Acme',
              fieldType: key === 'testOwnerPrincipalId' ? 'text' : 'checkbox',
            })
            const { target, attributes, ownerId } = await seedTarget(kind, operation !== 'forge')
            const value =
              operation === 'unset'
                ? null
                : key === 'testOwnerPrincipalId'
                  ? ownerId
                  : operation === 'forge'
            await expect(
              setConversationAttribute(target, key, value, source)
            ).rejects.toMatchObject({ code: 'ATTRIBUTE_RESERVED' })
            const stored = await readAttributes(target)
            expect(stored).toEqual(attributes)
            expect(isTestRecord(stored)).toBe(operation !== 'forge')
            expect(dispatchChanged).not.toHaveBeenCalled()
          }
        )
      }
    }

    it(`${kind} retains ordinary attribute write and unset with similar names`, async () => {
      await createConversationAttribute({ key: 'test_notes', label: 'Acme', fieldType: 'text' })
      const { target, attributes } = await seedTarget(kind, true)
      await setConversationAttribute(target, 'test_notes', 'Useful', 'workflow')
      expect(await readAttributes(target)).toMatchObject({
        ...attributes,
        test_notes: { v: 'Useful', src: 'workflow' },
      })
      await setConversationAttribute(target, 'test_notes', null, 'workflow')
      expect(await readAttributes(target)).toEqual(attributes)
    })
  }
})
