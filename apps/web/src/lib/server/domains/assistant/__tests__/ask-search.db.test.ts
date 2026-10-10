import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
// oxlint-disable-next-line no-restricted-imports -- this suite owns and closes its real test connection
import { createDb } from '@quackback/db/client'
import { createId } from '@quackback/ids'
import {
  principal,
  boards,
  posts,
  helpCenterCategories,
  helpCenterArticles,
  eq,
  sql,
} from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
import * as embeddings from '@/lib/server/domains/help-center/help-center-embedding.service'
import { searchAskEntities } from '../ask-search'
import {
  createWorkspaceScope,
  runWithWorkspaceScope,
} from '@/lib/server/workspaces/workspace-context'
import {
  makeWorkspaceDescriptor,
  makeWorkspaceSecrets,
} from '@/lib/server/__tests__/workspace-scope'
import type { Sql } from 'postgres'

const url =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
if (!new URL(url).pathname.startsWith('/quackback_test'))
  throw new Error('This suite requires a quackback_test database')
const connection = createDb(url, { max: 2, prepare: false })
const token = `ask${Date.now()}${Math.random().toString(36).slice(2)}`
const ownerId = createId('principal')
const boardId = createId('board')
const postId = createId('post')
const categoryId = createId('kb_category')
const articleId = createId('kb_article')
const deletedArticleId = createId('kb_article')
const actor: Actor = {
  principalId: ownerId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set(ALL_PERMISSIONS),
}
const flags = {
  feedback: true,
  helpCenter: true,
  supportInbox: false,
  supportTickets: false,
  changelog: false,
  statusPage: false,
}
const workspaceKey = `ask-search-${token}`
const scope = createWorkspaceScope({
  workspace: makeWorkspaceDescriptor(workspaceKey),
  secrets: makeWorkspaceSecrets(workspaceKey),
  db: connection,
  sql: (connection as unknown as { $client: Sql }).$client,
  origin: 'test',
})
const search = (query: string, viewer = actor, features = flags) =>
  runWithWorkspaceScope(scope, () => searchAskEntities(query, viewer, features))

beforeAll(async () => {
  await connection.execute(sql`select current_database()`)
  await connection.insert(principal).values({
    id: ownerId,
    role: 'admin',
    type: 'user',
    displayName: 'Acme',
    createdAt: new Date(),
  })
  await connection.insert(boards).values({ id: boardId, slug: token, name: 'Acme' })
  await connection.insert(posts).values({
    id: postId,
    boardId,
    title: `${token} idea`,
    content: `${token} feedback`,
    principalId: ownerId,
  })
  await connection
    .insert(helpCenterCategories)
    .values({ id: categoryId, slug: token, name: 'Acme', isPublic: false })
  await connection.insert(helpCenterArticles).values([
    {
      id: articleId,
      categoryId,
      slug: token,
      title: `${token} guide`,
      content: `${token} instructions`,
      principalId: ownerId,
    },
    {
      id: deletedArticleId,
      categoryId,
      slug: `${token}-deleted`,
      title: `${token} removed`,
      content: token,
      principalId: ownerId,
      deletedAt: new Date(),
    },
  ])
})

afterAll(async () => {
  vi.restoreAllMocks()
  await connection.delete(helpCenterArticles).where(eq(helpCenterArticles.categoryId, categoryId))
  await connection.delete(helpCenterCategories).where(eq(helpCenterCategories.id, categoryId))
  await connection.delete(posts).where(eq(posts.id, postId))
  await connection.delete(boards).where(eq(boards.id, boardId))
  await connection.delete(principal).where(eq(principal.id, ownerId))
  await (connection as unknown as { $client: { end(): Promise<void> } }).$client.end()
})

describe('instant Ask entity search on real Postgres', () => {
  it('returns matching owned entities and encoded admin links', async () => {
    const result = await search(token)
    expect(result.map((item) => item.id).sort()).toEqual([postId, articleId].sort())
    expect(result.find((item) => item.id === postId)?.href).toBe(`/admin/feedback?post=${postId}`)
    expect(result.find((item) => item.id === articleId)?.href).toBe(
      `/admin/help-center?article=${articleId}`
    )
  })
  it('never generates an embedding while typing', async () => {
    const generate = vi.spyOn(embeddings, 'generateKbQueryEmbedding')
    const result = await search(token)
    expect(result.some((item) => item.id === articleId)).toBe(true)
    expect(generate).not.toHaveBeenCalled()
  })
  it('honors explicit empty custom permissions despite an admin legacy role', async () => {
    expect(await search(token, { ...actor, permissions: new Set() })).toEqual([])
  })
  it('hides disabled modules and requires the exact article permission', async () => {
    expect(
      (await search(token, actor, { ...flags, helpCenter: false })).map((item) => item.id)
    ).toEqual([postId])
    expect(
      await search(token, { ...actor, permissions: new Set([PERMISSIONS.SETTINGS_MANAGE]) })
    ).toEqual([])
  })
  it('does not leak unrelated records for a different or blank query', async () => {
    expect(await search(`${token}missing`)).toEqual([])
    expect(await search(' ')).toEqual([])
  })
})
