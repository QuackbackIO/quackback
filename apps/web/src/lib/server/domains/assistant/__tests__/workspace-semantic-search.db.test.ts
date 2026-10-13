import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
// This suite owns and closes its independent real database pool.
// oxlint-disable-next-line no-restricted-imports
import { createDb } from '@quackback/db/client'
import {
  principal,
  boards,
  posts,
  conversations,
  conversationSummaries,
  eq,
  inArray,
  sql,
} from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
import {
  createWorkspaceScope,
  runWithWorkspaceScope,
} from '@/lib/server/workspaces/workspace-context'
import {
  makeWorkspaceDescriptor,
  makeWorkspaceSecrets,
} from '@/lib/server/__tests__/workspace-scope'
import { searchWorkspaceSemantically } from '../workspace-semantic-search'

const mock = vi.hoisted(() => ({ embedding: vi.fn() }))
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: mock.embedding,
}))
vi.mock('@/lib/server/domains/ai/models', () => ({ getEmbeddingModel: () => 'test-search-model' }))

const url = process.env.DATABASE_URL!
if (!new URL(url).pathname.startsWith('/quackback_test'))
  throw new Error('Requires a dedicated test database')
const connection = createDb(url, { max: 2, prepare: false })
const owner = createId('principal')
const board = createId('board')
const post = createId('post')
const deleted = createId('post')
const unrelated = createId('post')
const ownConversation = createId('conversation')
const otherConversation = createId('conversation')
const vector = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0))
const actor: Actor = {
  principalId: owner,
  principalType: 'user',
  role: 'admin',
  permissions: new Set(ALL_PERMISSIONS),
  segmentIds: new Set(),
}
const flags = {
  feedback: true,
  helpCenter: false,
  changelog: false,
  supportInbox: false,
  supportTickets: false,
}
const key = `semantic-${owner}`
const scope = createWorkspaceScope({
  workspace: makeWorkspaceDescriptor(key),
  secrets: makeWorkspaceSecrets(key),
  db: connection,
  sql: (connection as typeof connection & { $client: import('postgres').Sql }).$client,
  origin: 'test',
})
const search = (viewer = actor, features = flags) =>
  runWithWorkspaceScope(scope, () =>
    searchWorkspaceSemantically('pages loading slowly', viewer, features)
  )

beforeAll(async () => {
  await connection
    .insert(principal)
    .values({
      id: owner,
      type: 'user',
      role: 'admin',
      displayName: 'Search owner',
      createdAt: new Date(),
    })
  await connection
    .insert(boards)
    .values({ id: board, slug: `semantic-${owner}`, name: 'Search board' })
  await connection.insert(posts).values([
    {
      id: post,
      boardId: board,
      principalId: owner,
      title: 'Mobile performance',
      content: 'The portal takes too long to open',
      embedding: sql`${JSON.stringify(vector)}::vector`,
      embeddingModel: 'test-search-model',
    },
    {
      id: deleted,
      boardId: board,
      principalId: owner,
      title: 'Removed idea',
      content: 'Removed',
      embedding: sql`${JSON.stringify(vector)}::vector`,
      embeddingModel: 'test-search-model',
      deletedAt: new Date(),
    },
    {
      id: unrelated,
      boardId: board,
      principalId: owner,
      title: 'Unrelated',
      content: 'Other topic',
      embedding: sql`${JSON.stringify(vector.map((value) => -value))}::vector`,
      embeddingModel: 'test-search-model',
    },
  ])
  await connection.insert(conversations).values([
    {
      id: ownConversation,
      visitorPrincipalId: owner,
      assignedAgentPrincipalId: owner,
      subject: 'Assigned conversation',
      channel: 'messenger',
    },
    {
      id: otherConversation,
      visitorPrincipalId: owner,
      subject: 'Unassigned conversation',
      channel: 'messenger',
    },
  ])
  await connection
    .insert(conversationSummaries)
    .values(
      [ownConversation, otherConversation].map((conversationId) => ({
        conversationId,
        visitorPrincipalId: owner,
        summary: 'A slow page',
        embedding: sql`${JSON.stringify(vector)}::vector`,
        embeddingModel: 'test-search-model',
      }))
    )
}, 30_000)
afterAll(async () => {
  await connection
    .delete(conversations)
    .where(inArray(conversations.id, [ownConversation, otherConversation]))
  await connection.delete(posts).where(inArray(posts.id, [post, deleted, unrelated]))
  await connection.delete(boards).where(eq(boards.id, board))
  await connection.delete(principal).where(eq(principal.id, owner))
  await (connection as typeof connection & { $client: import('postgres').Sql }).$client.end({
    timeout: 5,
  })
}, 30_000)
beforeEach(() => {
  vi.clearAllMocks()
  mock.embedding.mockResolvedValue(vector)
})

it('uses real vector ranking to find a synonym match without returning deleted or unrelated rows', async () => {
  const result = await search()
  expect(result.available).toBe(true)
  expect(result.results.map((row) => row.id)).toEqual([post])
  expect(result.results[0].score).toBeCloseTo(1)
  expect(result.results[0].excerpt).toContain('takes too long')
  expect(mock.embedding).toHaveBeenCalledOnce()
})
it('does not call an embedding provider for an empty permission set', async () => {
  expect((await search({ ...actor, permissions: new Set() })).results).toEqual([])
  expect(mock.embedding).not.toHaveBeenCalled()
})
it('keeps row-level conversation visibility in semantic search', async () => {
  const scoped: Actor = {
    ...actor,
    role: 'member',
    permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
  }
  const result = await search(scoped, { ...flags, feedback: false, supportInbox: true })
  expect(result.results.map((row) => row.id)).toEqual([ownConversation])
})
it('reports an unavailable semantic provider separately from keyword search', async () => {
  mock.embedding.mockResolvedValue(null)
  expect(await search()).toEqual({ available: false, results: [] })
})
