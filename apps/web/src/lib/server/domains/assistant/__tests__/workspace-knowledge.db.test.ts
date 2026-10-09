import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, generateId, type ConversationId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationMessages,
  principal,
  user,
  helpCenterCategories,
  helpCenterArticles,
  assistantDocuments,
  assistantSnippets,
} from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { API_KEY_SCOPES } from '@/lib/shared/api-key-scopes'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/help-center/help-center-embedding.service', () => ({
  generateKbQueryEmbedding: async (actualQuery: string) => {
    expect(actualQuery).toBe(query)
    return null
  },
}))
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: async (actualQuery: string) => {
    expect(actualQuery).toBe(query)
    return null
  },
}))

import { workspaceConversationSource } from '../workspace-retrieval'

const fixture = await createDbTestFixture()
let member: Actor
let ownConversation: ConversationId
let foreignConversation: ConversationId
let query: string

async function seedPrincipal(role: 'member' | 'user'): Promise<PrincipalId> {
  const principalId = createId('principal')
  const userId = createId('user')
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type: 'user',
    createdAt: new Date(),
  })
  return principalId
}

async function message(
  conversationId: ConversationId,
  suffix: string,
  age: number,
  internal = false,
  deleted = false
) {
  await testDb.insert(conversationMessages).values({
    id: createId('conversation_message'),
    conversationId,
    senderType: 'agent',
    content: `${query} ${suffix}`,
    isInternal: internal,
    deletedAt: deleted ? new Date() : null,
    createdAt: new Date(Date.UTC(2026, 9, 3, 9, 0, age)),
  })
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  query = `knowledge${createId('user').replace(/[^a-z0-9]/g, '')}`
  const owner = await seedPrincipal('member')
  const other = await seedPrincipal('member')
  const visitor = await seedPrincipal('user')
  member = {
    principalId: owner,
    principalType: 'user',
    role: 'member',
    segmentIds: new Set(),
    permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
  }
  ownConversation = createId('conversation')
  foreignConversation = createId('conversation')
  await testDb.insert(conversations).values([
    {
      id: ownConversation,
      visitorPrincipalId: visitor,
      channel: 'messenger',
      assignedAgentPrincipalId: owner,
    },
    {
      id: foreignConversation,
      visitorPrincipalId: visitor,
      channel: 'messenger',
      assignedAgentPrincipalId: other,
    },
  ])
  await message(ownConversation, 'first public reply', 0)
  await message(ownConversation, 'latest public reply', 1)
  await message(ownConversation, 'team note', 2, true)
  await message(ownConversation, 'deleted reply', 3, false, true)
  await message(foreignConversation, 'other team reply', 4)
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())

describe('workspace knowledge access', () => {
  it('shares real SDK entity tools with database-backed cited knowledge without exposing non-reversible writes', async () => {
    const { openWorkspaceMcp } = await import('../mcp-workspace-tools')
    const { makeAssistantToolContext } = await import('../assistant.toolspec')
    const { assembleAssistantToolset } = await import('../assistant.tools')
    const categoryId = createId('kb_category')
    const articleSeedId = generateId('article')
    const documentId = createId('assistant_document')
    const snippetId = createId('assistant_snippet')
    await testDb.insert(helpCenterCategories).values({
      id: categoryId,
      slug: categoryId,
      name: 'Acme guides',
      isPublic: true,
    })
    const [{ id: articleId }] = await testDb
      .insert(helpCenterArticles)
      .values({
        id: articleSeedId,
        categoryId,
        principalId: member.principalId!,
        slug: articleSeedId,
        title: query,
        content: `${query} Published setup instructions.`,
        publishedAt: new Date(Date.UTC(2026, 0, 1)),
      })
      .returning({ id: helpCenterArticles.id })
    await testDb.insert(assistantDocuments).values({
      id: documentId,
      title: `${query} handbook`,
      fileName: 'handbook.txt',
      mimeType: 'text/plain',
      content: `${query} Uploaded setup instructions.`,
    })
    await testDb.insert(assistantSnippets).values({
      id: snippetId,
      title: query,
      content: 'Saved setup answer.',
      audience: 'team',
      enabled: true,
    })
    const opened = await openWorkspaceMcp({
      principalId: member.principalId!,
      name: 'Acme',
      role: 'member',
      authMethod: 'oauth',
      scopes: [...API_KEY_SCOPES],
      permissions: member.permissions,
    })
    try {
      const context = makeAssistantToolContext({
        db: testDb,
        actor: member,
        assistantPrincipalId: member.principalId!,
        role: 'workspace_assistant',
        audience: 'team',
        conversationId: null,
        workspaceThreadKey: 'workspace:knowledge-test',
        simulate: false,
        knowledge: {
          sources: new Set(['article', 'document', 'snippet', 'summary']),
          status: false,
          internalNotes: true,
          pastConversations: true,
        },
      })
      const assembled = await assembleAssistantToolset(context, undefined, opened.specs)
      const names = assembled.tools.map((tool) => tool.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'search_knowledge',
          'search',
          'get_details',
          'list_conversations',
          'get_conversation',
          'list_tickets',
          'get_ticket',
          'get_post_activity',
          'widget_install_status',
          'get_settings',
          'navigate_workspace',
          'propose_settings_change',
        ])
      )
      expect(new Set(names).size).toBe(names.length)
      expect(
        assembled.activeSpecs.filter((spec) => spec.risk === 'write').map((spec) => spec.name)
      ).toEqual(['propose_settings_change'])
      const knowledge = assembled.tools.find((tool) => tool.name === 'search_knowledge')!
      const result = (await knowledge.execute!({ query })) as {
        results: { id: string; kind: string }[]
      }
      expect(result.results.map((item) => item.id)).toEqual(
        expect.arrayContaining([articleId, documentId, snippetId, ownConversation])
      )
      expect(result.results.map((item) => item.id)).not.toContain(foreignConversation)
      expect(context.ledger.sources.get(articleId)).toMatchObject({
        type: 'article',
        id: articleId,
      })
      expect(context.ledger.sources.get(documentId)).toMatchObject({
        type: 'document',
        id: documentId,
      })
      expect(context.ledger.sources.get(snippetId)).toMatchObject({
        type: 'snippet',
        id: snippetId,
        internal: true,
      })
      expect(context.ledger.sources.get(ownConversation)).toMatchObject({
        type: 'summary',
        id: ownConversation,
        internal: true,
      })
    } finally {
      await opened.close()
    }
  })
  it('retrieves only visible conversations and the latest allowed message', async () => {
    const items = await workspaceConversationSource(false, false, member).retrieve(query, 'team', {
      topK: 5,
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: ownConversation,
      excerpt: `${query} latest public reply`,
      citation: {
        type: 'summary',
        id: ownConversation,
        internal: true,
        url: `/admin/inbox?i=${ownConversation}`,
      },
    })
  })
  it('requires a team ceiling, requesting actor and conversation permission', async () => {
    expect(
      await workspaceConversationSource(true, false, member).retrieve(query, 'public', { topK: 5 })
    ).toEqual([])
    expect(await workspaceConversationSource(true).retrieve(query, 'team', { topK: 5 })).toEqual([])
    expect(
      await workspaceConversationSource(true, false, {
        ...member,
        permissions: new Set(),
      }).retrieve(query, 'team', { topK: 5 })
    ).toEqual([])
  })
  it('includes internal notes only when enabled and keeps the notes-only narrowing', async () => {
    const withNotes = await workspaceConversationSource(true, false, member).retrieve(
      query,
      'team',
      { topK: 5 }
    )
    expect(withNotes.map((item) => item.excerpt)).toEqual([`${query} team note`])
    await message(ownConversation, 'newer public reply', 5)
    const notesOnly = await workspaceConversationSource(true, true, member).retrieve(
      query,
      'team',
      { topK: 5 }
    )
    expect(notesOnly.map((item) => item.excerpt)).toEqual([`${query} team note`])
  })
  it('allows a workspace-wide viewer to ground on other visible conversations', async () => {
    const viewer = { ...member, permissions: new Set([PERMISSIONS.CONVERSATION_VIEW_ALL]) }
    const items = await workspaceConversationSource(false, false, viewer).retrieve(query, 'team', {
      topK: 5,
    })
    expect(items.map((item) => item.id)).toEqual([foreignConversation, ownConversation])
  })
})
