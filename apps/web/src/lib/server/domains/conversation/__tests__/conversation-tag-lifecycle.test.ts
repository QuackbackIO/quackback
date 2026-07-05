/**
 * Real-DB coverage for the tag lifecycle behind the settings Tags tab:
 * the all-tags usage listing (archived included), the automation-reference
 * guard (live workflows + macros block archive/delete, names surfaced), and
 * restore + permanent-delete-behind-archive. Runs inside the db-test-fixture
 * rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationTagId, PrincipalId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationTags,
  conversationTagAssignments,
  workflows,
  macros,
  principal,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  listAllConversationTagsWithUsage,
  findTagAutomationReferences,
  deleteConversationTag,
  restoreConversationTag,
  hardDeleteConversationTag,
} from '../conversation-tag.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversationTags.id }).from(conversationTags).limit(0)
    await db.select({ id: workflows.id }).from(workflows).limit(0)
    await db.select({ id: macros.id }).from(macros).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTag(name?: string): Promise<ConversationTagId> {
  const [tag] = await testDb
    .insert(conversationTags)
    .values({ name: name ?? `tag-${suffix()}` })
    .returning()
  return tag.id
}

async function seedConversationWithTag(tagId: ConversationTagId): Promise<void> {
  const [visitor] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor.id as PrincipalId, channel: 'messenger' })
    .returning()
  await testDb
    .insert(conversationTagAssignments)
    .values({ conversationId: conversation.id, conversationTagId: tagId })
}

describe.skipIf(!fixture.available)('conversation tag lifecycle (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('lists every tag with total usage, archived included', async () => {
    const used = await seedTag()
    await seedConversationWithTag(used)
    await seedConversationWithTag(used)
    const archived = await seedTag()
    await deleteConversationTag(archived)

    const list = await listAllConversationTagsWithUsage()
    const usedRow = list.find((t) => t.id === used)
    const archivedRow = list.find((t) => t.id === archived)
    expect(usedRow).toMatchObject({ count: 2, archived: false })
    expect(archivedRow).toMatchObject({ count: 0, archived: true })
  })

  it('reports which live workflows and macros reference a tag', async () => {
    const tagId = await seedTag()
    await testDb.insert(workflows).values({
      name: 'Route VIPs',
      class: 'background',
      status: 'live',
      triggerType: 'conversation.created',
      graph: { nodes: [{ id: 'a1', type: 'action', action: { type: 'add_tag', tagId } }] },
    })
    // Draft workflows do not block (only live automations can break).
    await testDb.insert(workflows).values({
      name: 'Draft idea',
      class: 'background',
      status: 'draft',
      triggerType: 'conversation.created',
      graph: { nodes: [{ id: 'a1', type: 'action', action: { type: 'remove_tag', tagId } }] },
    })
    await testDb.insert(macros).values({
      name: 'Escalate',
      body: 'On it',
      actions: [{ type: 'add_tag', tagId }],
    })

    const refs = await findTagAutomationReferences(tagId)
    expect(refs.workflows).toEqual(['Route VIPs'])
    expect(refs.macros).toEqual(['Escalate'])

    const unreferenced = await seedTag()
    const none = await findTagAutomationReferences(unreferenced)
    expect(none.workflows).toEqual([])
    expect(none.macros).toEqual([])
  })

  it('a workflow condition on conversation.tags also counts as a reference', async () => {
    const tagId = await seedTag()
    await testDb.insert(workflows).values({
      name: 'VIP branch',
      class: 'customer_facing',
      status: 'live',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          {
            id: 'c1',
            type: 'condition',
            condition: { field: 'conversation.tags', op: 'includes_any', value: [tagId] },
          },
        ],
      },
    })
    const refs = await findTagAutomationReferences(tagId)
    expect(refs.workflows).toEqual(['VIP branch'])
  })

  it('blocks archive and permanent delete while referenced, naming the automations', async () => {
    const tagId = await seedTag()
    await testDb.insert(workflows).values({
      name: 'Route VIPs',
      class: 'background',
      status: 'live',
      triggerType: 'conversation.created',
      graph: { nodes: [{ id: 'a1', type: 'action', action: { type: 'add_tag', tagId } }] },
    })

    await expect(deleteConversationTag(tagId)).rejects.toMatchObject({
      code: 'TAG_IN_USE',
      message: expect.stringContaining('Route VIPs'),
    })
  })

  it('archive + restore round-trips; permanent delete only behind archive', async () => {
    const tagId = await seedTag()
    await seedConversationWithTag(tagId)

    // Not archived yet: permanent delete refused.
    await expect(hardDeleteConversationTag(tagId)).rejects.toMatchObject({
      code: 'TAG_NOT_ARCHIVED',
    })

    await deleteConversationTag(tagId)
    const restored = await restoreConversationTag(tagId)
    expect(restored.id).toBe(tagId)

    await deleteConversationTag(tagId)
    await hardDeleteConversationTag(tagId)
    const rows = await testDb
      .select({ id: conversationTags.id })
      .from(conversationTags)
      .where(eq(conversationTags.id, tagId))
    expect(rows).toHaveLength(0)
    // Assignments cascade with the row.
    const assignments = await testDb
      .select({ id: conversationTagAssignments.conversationTagId })
      .from(conversationTagAssignments)
      .where(eq(conversationTagAssignments.conversationTagId, tagId))
    expect(assignments).toHaveLength(0)
  })
})
