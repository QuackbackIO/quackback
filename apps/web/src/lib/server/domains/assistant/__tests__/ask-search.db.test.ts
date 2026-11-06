/**
 * Workspace search on real Postgres: one ranked list across every kind, and
 * for each kind a scoped viewer never gets a record they could not open.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  principal,
  user,
  boards,
  posts,
  helpCenterCategories,
  helpCenterArticles,
  changelogEntries,
  conversations,
  conversationMessages,
  conversationSummaries,
  tickets,
  ticketStatuses,
  ticketConversations,
  companies,
  inArray,
  sql,
} from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const embedding = vi.hoisted(() => ({ generate: vi.fn(), model: vi.fn() }))
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: embedding.generate,
}))
vi.mock('@/lib/server/domains/ai/models', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/ai/models')>()),
  getEmbeddingModel: embedding.model,
}))

import { searchWorkspace } from '../ask-search'
import { clearSemanticSearchCache } from '../workspace-semantic-search'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: companies.id }).from(companies).limit(0)
    await db.execute(sql`select 'tickets_title_search_idx'::regclass`)
  },
})

const flags = {
  feedback: true,
  helpCenter: true,
  changelog: true,
  supportInbox: true,
  supportTickets: true,
}
// A word no other suite writes, so results are only this test's rows.
const word = `zq${Date.now().toString(36)}`
const ids = {
  admin: createId('principal'),
  member: createId('principal'),
  other: createId('principal'),
  contact: createId('principal'),
  testCustomer: createId('principal'),
}
const admin: Actor = {
  principalId: ids.admin,
  principalType: 'user',
  role: 'admin',
  permissions: new Set(ALL_PERMISSIONS),
  segmentIds: new Set(),
}
const member = (...permissions: PermissionKey[]): Actor => ({
  principalId: ids.member,
  principalType: 'user',
  role: 'member',
  permissions: new Set(permissions),
  segmentIds: new Set(),
})
const vector = (sign: number) => Array.from({ length: 1536 }, (_, i) => (i === 0 ? sign : 0))
const vectorSql = (sign: number) => sql`${JSON.stringify(vector(sign))}::vector`

let seeded: Record<string, string>

async function seed() {
  const userIds = {
    admin: createId('user'),
    member: createId('user'),
    other: createId('user'),
    contact: createId('user'),
    testCustomer: createId('user'),
  }
  await testDb.insert(user).values([
    { id: userIds.admin, name: 'Avery Admin', email: `${userIds.admin}@example.com` },
    { id: userIds.member, name: 'Mo Member', email: `${userIds.member}@example.com` },
    { id: userIds.other, name: `${word} Teammate`, email: `other-${word}-x@example.org` },
    { id: userIds.contact, name: `${word} Contact`, email: `contact-${word}-x@example.org` },
    { id: userIds.testCustomer, name: `${word} Tester`, email: `tester-${word}-x@example.org` },
  ])
  const at = new Date()
  await testDb.insert(principal).values([
    { id: ids.admin, userId: userIds.admin, role: 'admin', type: 'user', createdAt: at },
    { id: ids.member, userId: userIds.member, role: 'member', type: 'user', createdAt: at },
    { id: ids.other, userId: userIds.other, role: 'member', type: 'user', createdAt: at },
    { id: ids.contact, userId: userIds.contact, role: 'user', type: 'user', createdAt: at },
    {
      id: ids.testCustomer,
      userId: userIds.testCustomer,
      role: 'user',
      type: 'user',
      testOwnerPrincipalId: ids.admin,
      createdAt: at,
    },
  ])

  const board = createId('board')
  await testDb.insert(boards).values({ id: board, slug: `b-${word}`, name: 'Board' })
  const post = {
    exact: createId('post'),
    body: createId('post'),
    pending: createId('post'),
    deleted: createId('post'),
  }
  await testDb.insert(posts).values([
    {
      id: post.exact,
      boardId: board,
      title: word,
      content: 'Exact title',
      principalId: ids.contact,
    },
    {
      id: post.body,
      boardId: board,
      title: 'Faster exports',
      content: `Customers mention ${word} in passing`,
      principalId: ids.contact,
    },
    {
      id: post.pending,
      boardId: board,
      title: `${word} pending idea`,
      content: '',
      principalId: ids.contact,
      moderationState: 'pending',
    },
    {
      id: post.deleted,
      boardId: board,
      title: `${word} removed idea`,
      content: '',
      principalId: ids.contact,
      deletedAt: new Date(),
    },
  ])

  const publicCategory = createId('kb_category')
  const privateCategory = createId('kb_category')
  await testDb.insert(helpCenterCategories).values([
    { id: publicCategory, slug: `pub-${word}`, name: 'Public', isPublic: true },
    { id: privateCategory, slug: `priv-${word}`, name: 'Private', isPublic: false },
  ])
  const article = {
    published: createId('kb_article'),
    draft: createId('kb_article'),
    privateCategory: createId('kb_article'),
  }
  await testDb.insert(helpCenterArticles).values([
    {
      id: article.published,
      categoryId: publicCategory,
      slug: `guide-${word}`,
      title: `${word} guide`,
      content: 'How it works',
      principalId: ids.admin,
      publishedAt: new Date(Date.now() - 60_000),
    },
    {
      id: article.draft,
      categoryId: publicCategory,
      slug: `draft-${word}`,
      title: `${word} draft`,
      content: '',
      principalId: ids.admin,
    },
    {
      id: article.privateCategory,
      categoryId: privateCategory,
      slug: `internal-${word}`,
      title: `${word} internal`,
      content: '',
      principalId: ids.admin,
      publishedAt: new Date(Date.now() - 60_000),
    },
  ])

  const entry = { published: createId('changelog'), draft: createId('changelog') }
  await testDb.insert(changelogEntries).values([
    {
      id: entry.published,
      title: `${word} release`,
      content: 'Shipped',
      publishedAt: new Date(Date.now() - 60_000),
    },
    { id: entry.draft, title: `${word} upcoming`, content: 'Not yet' },
  ])

  const conversation = { mine: createId('conversation'), theirs: createId('conversation') }
  await testDb.insert(conversations).values([
    {
      id: conversation.mine,
      visitorPrincipalId: ids.contact,
      assignedAgentPrincipalId: ids.member,
      channel: 'messenger',
      subject: 'Billing question',
    },
    {
      id: conversation.theirs,
      visitorPrincipalId: ids.contact,
      assignedAgentPrincipalId: ids.other,
      channel: 'messenger',
      subject: `${word} for someone else`,
    },
  ])
  await testDb.insert(conversationMessages).values({
    conversationId: conversation.mine,
    principalId: ids.contact,
    senderType: 'visitor',
    content: `My invoice mentions ${word} twice`,
  })

  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Open', slug: createId('ticket_status') })
    .returning()
  const ticket = {
    mine: createId('ticket'),
    theirs: createId('ticket'),
    deleted: createId('ticket'),
  }
  await testDb.insert(tickets).values([
    {
      id: ticket.mine,
      title: 'Printer jam',
      statusId: status.id,
      requesterPrincipalId: ids.contact,
      assigneePrincipalId: ids.member,
    },
    {
      id: ticket.theirs,
      title: `${word} escalation`,
      statusId: status.id,
      requesterPrincipalId: ids.contact,
      assigneePrincipalId: ids.other,
    },
    {
      id: ticket.deleted,
      title: `${word} removed ticket`,
      statusId: status.id,
      requesterPrincipalId: ids.contact,
      assigneePrincipalId: ids.member,
      deletedAt: new Date(),
    },
  ])
  // The member's ticket matches only through its paired conversation's message.
  await testDb
    .insert(ticketConversations)
    .values({ ticketId: ticket.mine, conversationId: conversation.mine, ticketType: 'customer' })

  const company = createId('company')
  await testDb
    .insert(companies)
    .values({ id: company, name: `${word} Industries`, domain: `${word}.io` })

  const flat = (prefix: string, record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [`${prefix}.${key}`, value]))
  seeded = {
    ...flat('post', post),
    ...flat('article', article),
    ...flat('changelog', entry),
    ...flat('conversation', conversation),
    ...flat('ticket', ticket),
    company,
  }
}

type Options = Parameters<typeof searchWorkspace>[3]
const search = (actor: Actor, options: Options = {}, q = word) =>
  searchWorkspace(q, actor, flags, { limit: 50, ...options })
const idsOf = async (actor: Actor, options: Options = {}) =>
  (await search(actor, options)).results.map((result) => result.id)

describe.skipIf(!fixture.available)('workspace search (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    await seed()
    clearSemanticSearchCache()
    embedding.generate.mockReset()
    embedding.model.mockReturnValue(null)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('finds every kind an admin may open in one list, exact title first', async () => {
    const { results } = await search(admin)
    expect(results[0]).toMatchObject({ id: seeded['post.exact'], kind: 'post' })
    expect(Math.floor(results[0].score)).toBe(3)
    expect(new Set(results.map((result) => result.kind))).toEqual(
      new Set([
        'post',
        'article',
        'changelog',
        'conversation',
        'ticket',
        'person',
        'teammate',
        'company',
      ])
    )
    // Kinds are mixed by score, not grouped, and a body-only match comes after every title match.
    const scores = results.map((result) => result.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    const bodyOnly = results.find((result) => result.id === seeded['post.body'])!
    expect(bodyOnly.score).toBeLessThan(1)
    expect(bodyOnly.excerpt).toContain(word)
    const company = results.find((result) => result.kind === 'company')!
    expect(company).toMatchObject({
      href: `/admin/users?lifecycle=companies&company=${seeded.company}`,
      subtitle: `${word}.io`,
    })
    expect(Math.floor(company.score)).toBe(2)
  })

  it('never returns deleted posts or tickets, or test customers', async () => {
    const found = await idsOf(admin)
    expect(found).not.toContain(seeded['post.deleted'])
    expect(found).not.toContain(seeded['ticket.deleted'])
    expect(found).not.toContain(ids.testCustomer)
    expect(found).toContain(ids.contact)
  })

  it('posts: a teammate without post.view_private gets published posts only', async () => {
    expect(await idsOf(admin, { kind: 'post' })).toContain(seeded['post.pending'])
    const found = await idsOf(member(), { kind: 'post' })
    expect(found).toContain(seeded['post.exact'])
    expect(found).not.toContain(seeded['post.pending'])
  })

  it('conversations: conversation.view sees assigned-to-me only; none without it', async () => {
    expect(await idsOf(member(PERMISSIONS.CONVERSATION_VIEW), { kind: 'conversation' })).toEqual([
      seeded['conversation.mine'],
    ])
    expect(await idsOf(member(), { kind: 'conversation' })).toEqual([])
    expect((await idsOf(admin, { kind: 'conversation' })).sort()).toEqual(
      [seeded['conversation.mine'], seeded['conversation.theirs']].sort()
    )
  })

  it('tickets: ticket.view sees assigned-to-me only, matched through the paired conversation', async () => {
    expect(await idsOf(member(PERMISSIONS.TICKET_VIEW), { kind: 'ticket' })).toEqual([
      seeded['ticket.mine'],
    ])
    expect(await idsOf(member(), { kind: 'ticket' })).toEqual([])
    expect((await idsOf(admin, { kind: 'ticket' })).sort()).toEqual(
      [seeded['ticket.mine'], seeded['ticket.theirs']].sort()
    )
  })

  it('articles: a non-manager finds published public articles, linked to the help center', async () => {
    const { results } = await search(member(), { kind: 'article' })
    expect(results.map((result) => result.id)).toEqual([seeded['article.published']])
    expect(results[0].href).toMatch(/^\/hc\/en\/articles\/\d+-guide-/)
    const managed = await search(member(PERMISSIONS.HELP_CENTER_MANAGE), { kind: 'article' })
    expect(managed.results.map((result) => result.id).sort()).toEqual(
      [
        seeded['article.published'],
        seeded['article.draft'],
        seeded['article.privateCategory'],
      ].sort()
    )
    expect(managed.results[0].href).toMatch(/^\/admin\/help-center\?article=/)
  })

  it('changelog: drafts need the draft permission', async () => {
    expect(await idsOf(member(), { kind: 'changelog' })).toEqual([seeded['changelog.published']])
    expect(
      (await idsOf(member(PERMISSIONS.CHANGELOG_VIEW_DRAFT), { kind: 'changelog' })).sort()
    ).toEqual([seeded['changelog.published'], seeded['changelog.draft']].sort())
  })

  it('people, teammates and companies need their own view permissions', async () => {
    expect(await idsOf(member(), { kind: 'person' })).toEqual([])
    expect(await idsOf(member(), { kind: 'teammate' })).toEqual([])
    expect(await idsOf(member(PERMISSIONS.PEOPLE_VIEW), { kind: 'person' })).toEqual([ids.contact])
    expect(await idsOf(member(PERMISSIONS.MEMBER_VIEW), { kind: 'teammate' })).toEqual([ids.other])
    expect(await idsOf(member(PERMISSIONS.COMPANY_VIEW), { kind: 'company' })).toEqual([])
    expect(
      await idsOf(member(PERMISSIONS.PEOPLE_VIEW, PERMISSIONS.COMPANY_VIEW), { kind: 'company' })
    ).toEqual([seeded.company])
  })

  it('finds nothing for a portal user, or a teammate with every product off', async () => {
    const off = { feedback: false, helpCenter: false, changelog: false }
    expect((await searchWorkspace(word, member(), off)).results).toEqual([])
    expect((await searchWorkspace(word, { ...admin, role: 'user' }, flags)).results).toEqual([])
  })

  it('pages through one order without repeats', async () => {
    const all = (await search(admin)).results.map((result) => result.id)
    const first = await search(admin, { limit: 4 })
    const second = await search(admin, { limit: 4, offset: 4 })
    expect(first.hasMore).toBe(true)
    expect([...first.results, ...second.results].map((result) => result.id)).toEqual(
      all.slice(0, 8)
    )
    const last = await search(admin, { limit: 4, offset: all.length - 2 })
    expect(last.hasMore).toBe(false)
    expect(last.results).toHaveLength(2)
  })

  describe('matches by meaning', () => {
    beforeEach(async () => {
      embedding.model.mockReturnValue('test-search-model')
      embedding.generate.mockResolvedValue(vector(1))
      // Exact distances: an HNSW graph full of rolled-back test rows can miss
      // fresh ones until it is vacuumed, which is not what these tests pin.
      await testDb.execute(sql`set local enable_indexscan = off`)
      await testDb
        .update(posts)
        .set({ embedding: vectorSql(1) as never, embeddingModel: 'test-search-model' })
        .where(
          inArray(
            posts.id,
            Object.keys(seeded)
              .filter((key) => key.startsWith('post.'))
              .map((key) => seeded[key] as never)
          )
        )
      await testDb.insert(conversationSummaries).values(
        [seeded['conversation.mine'], seeded['conversation.theirs']].map((conversationId) => ({
          conversationId: conversationId as never,
          visitorPrincipalId: ids.contact as PrincipalId,
          summary: 'Slow pages',
          embedding: vectorSql(1) as never,
          embeddingModel: 'test-search-model',
        }))
      )
    })

    it('merges records that share no words, under the same visibility, with one embedding', async () => {
      const synonym = 'sluggish loading'
      const viewer = member(PERMISSIONS.CONVERSATION_VIEW)
      const page = await searchWorkspace(synonym, viewer, flags, { semantic: true, limit: 2 })
      const next = await searchWorkspace(synonym, viewer, flags, {
        semantic: true,
        limit: 50,
        offset: 2,
      })
      const found = [...page.results, ...next.results].map((result) => result.id)
      expect(found).toContain(seeded['post.exact'])
      expect(found).toContain(seeded['conversation.mine'])
      expect(found).not.toContain(seeded['conversation.theirs'])
      expect(found).not.toContain(seeded['post.pending'])
      expect(found).not.toContain(seeded['post.deleted'])
      expect(embedding.generate).toHaveBeenCalledTimes(1)
    })

    it('falls back to full text alone when the provider gives nothing or fails', async () => {
      embedding.generate.mockResolvedValue(null)
      expect((await search(admin, { semantic: true, kind: 'post' }, 'sluggish')).results).toEqual(
        []
      )
      clearSemanticSearchCache()
      embedding.generate.mockRejectedValue(new Error('provider down'))
      const { results } = await search(admin, { semantic: true, kind: 'post' })
      expect(results.map((result) => result.id)).toContain(seeded['post.exact'])
    })

    it('never asks for an embedding unless the results page wants meaning', async () => {
      await search(admin)
      expect(embedding.generate).not.toHaveBeenCalled()
    })
  })
})
