/**
 * Real-DB coverage for relevance-ranked inbox search: when
 * `listConversationsForAgent` is given a `search` term, the page comes back
 * ordered by a computed relevance score (keyword frequency, exactness,
 * recency) instead of the list's active sort. Runs inside the db-test-fixture
 * rollback transaction (see server/__tests__/README.md), alongside a DB-free
 * suite for the term escaper the exactness signal depends on.
 *
 * Every DB case searches an invented term, so the assertions describe only the
 * rows this file seeds, whatever else the test database holds.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, conversationMessages, principal, user, PERMISSIONS } from '@/lib/server/db'
import type { PermissionKey } from '@/lib/server/db'
import type { ConversationSort } from '@/lib/shared/conversation/views'
import { listConversationsForAgent } from '../conversation.query'
import { escapePosixRegex } from '../conversation-relevance'
import type { Actor } from '@/lib/server/policy/types'

describe('escapePosixRegex', () => {
  it('strips the meaning from every regex metacharacter', () => {
    expect(escapePosixRegex('a+b')).toBe('a\\+b')
    expect(escapePosixRegex('(a|b)*')).toBe('\\(a\\|b\\)\\*')
    expect(escapePosixRegex('c:\\path[0].{2}')).toBe('c:\\\\path\\[0\\]\\.\\{2\\}')
  })

  it('leaves an ordinary term untouched', () => {
    expect(escapePosixRegex('refund policy')).toBe('refund policy')
  })
})

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ v: conversationMessages.searchVector }).from(conversationMessages).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const AGENT: Actor = {
  principalId: createId('principal') as PrincipalId,
  role: null,
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set<PermissionKey>([PERMISSIONS.CONVERSATION_VIEW_ALL]),
}

const DAY = 86_400_000

/** Seed one conversation: a visitor with `name`, activity at `at`, and one
 *  visitor message per entry in `messages`. */
async function seedConversation(opts: {
  name: string
  at: Date
  messages: string[]
}): Promise<ConversationId> {
  const userId = createId('user') as UserId
  const visitorPrincipalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: opts.name })
  await testDb.insert(principal).values({
    id: visitorPrincipalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: opts.name,
    createdAt: new Date(),
  })
  const id = createId('conversation') as ConversationId
  await testDb.insert(conversations).values({
    id,
    visitorPrincipalId,
    channel: 'messenger',
    createdAt: opts.at,
    lastMessageAt: opts.at,
  })
  for (const content of opts.messages) {
    await testDb.insert(conversationMessages).values({
      conversationId: id,
      principalId: visitorPrincipalId,
      senderType: 'visitor',
      content,
      createdAt: opts.at,
    })
  }
  return id
}

/** Ids of the seeded rows a search returns, in the order the query produced.
 *  `sort` omitted = the list pins no sort, so relevance ranks it. */
async function searchOrder(
  search: string,
  seeded: readonly ConversationId[],
  sort?: ConversationSort
): Promise<ConversationId[]> {
  const page = await listConversationsForAgent({ search, sort, limit: 50 }, AGENT)
  const known = new Set<string>(seeded)
  return page.conversations.map((c) => c.id).filter((id) => known.has(id))
}

describe.skipIf(!fixture.available)('relevance-ranked inbox search (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('ranks a repeatedly-matched thread above a fresher single mention', async () => {
    const term = `zonkle${suffix().replace(/[^a-z0-9]/g, '')}`
    const repeated = await seedConversation({
      name: 'Dana Okoye',
      at: new Date(Date.now() - 300 * DAY),
      messages: [`${term} ${term} ${term} ${term} ${term} keeps failing on checkout`],
    })
    const fresh = await seedConversation({
      name: 'Priya Raman',
      at: new Date(),
      messages: [`one passing note about ${term} and nothing else`],
    })

    // 'recent' would put the fresh thread first; relevance puts the dense one first.
    expect(await searchOrder(term, [repeated, fresh])).toEqual([repeated, fresh])
  })

  it('ranks a whole-word hit above a hit buried inside a longer word', async () => {
    const stem = `flurb${suffix().replace(/[^a-z0-9]/g, '')}`
    const buried = await seedConversation({
      name: 'Dana Okoye',
      at: new Date(),
      messages: [`the ${stem}ing widget stalled`],
    })
    const exact = await seedConversation({
      name: 'Priya Raman',
      at: new Date(Date.now() - 30 * DAY),
      messages: [`the ${stem} arrived damaged`],
    })

    expect(await searchOrder(stem, [buried, exact])).toEqual([exact, buried])
  })

  it('ranks the visitor whose display name IS the term first', async () => {
    const name = `Zorblatt${suffix().replace(/[^a-z0-9]/g, '')}`
    const mentioned = await seedConversation({
      name: 'Dana Okoye',
      at: new Date(),
      messages: [`please loop in ${name} ${name} ${name} on this`],
    })
    const named = await seedConversation({
      name,
      at: new Date(Date.now() - 90 * DAY),
      messages: ['my card was declined twice'],
    })

    expect(await searchOrder(name, [mentioned, named])).toEqual([named, mentioned])
  })

  it('breaks an otherwise even match on recency', async () => {
    const term = `wibblex${suffix().replace(/[^a-z0-9]/g, '')}`
    const older = await seedConversation({
      name: 'Dana Okoye',
      at: new Date(Date.now() - 120 * DAY),
      messages: [`the ${term} report is wrong`],
    })
    const newer = await seedConversation({
      name: 'Priya Raman',
      at: new Date(),
      messages: [`the ${term} report is wrong`],
    })

    expect(await searchOrder(term, [older, newer])).toEqual([newer, older])
  })

  it('keeps a substring-only match in the results, ranked last', async () => {
    const term = `grum${suffix().replace(/[^a-z0-9]/g, '')}`
    const substringOnly = await seedConversation({
      name: 'Dana Okoye',
      at: new Date(),
      messages: [`re${term}bling noises from the fan`],
    })
    const wholeWord = await seedConversation({
      name: 'Priya Raman',
      at: new Date(Date.now() - 200 * DAY),
      messages: [`a ${term} on the invoice`],
    })

    const order = await searchOrder(term, [substringOnly, wholeWord])
    expect(order).toEqual([wholeWord, substringOnly])
  })

  it('treats regex metacharacters in the term as literal text', async () => {
    const literal = await seedConversation({
      name: 'Dana Okoye',
      at: new Date(),
      messages: ['the (a|b)* build step fails'],
    })
    const decoy = await seedConversation({
      name: 'Priya Raman',
      at: new Date(),
      messages: ['the aab build step fails'],
    })

    // Scored, not interpreted: only the verbatim occurrence matches at all.
    expect(await searchOrder('(a|b)*', [literal, decoy])).toEqual([literal])
  })

  it('leaves the active sort in charge when there is no search term', async () => {
    const older = await seedConversation({
      name: 'Dana Okoye',
      at: new Date(Date.now() - 5 * DAY),
      messages: ['first'],
    })
    const newer = await seedConversation({
      name: 'Priya Raman',
      at: new Date(),
      messages: ['second'],
    })

    const recent = await listConversationsForAgent({ sort: 'recent', limit: 50 }, AGENT)
    const seen = new Set<string>([older, newer])
    expect(recent.conversations.map((c) => c.id).filter((id) => seen.has(id))).toEqual([
      newer,
      older,
    ])

    const oldest = await listConversationsForAgent({ sort: 'oldest', limit: 50 }, AGENT)
    expect(oldest.conversations.map((c) => c.id).filter((id) => seen.has(id))).toEqual([
      older,
      newer,
    ])
  })

  it('lets an explicitly pinned sort outrank relevance on a searched list', async () => {
    const term = `brindle${suffix().replace(/[^a-z0-9]/g, '')}`
    // The densest match is also the oldest, so relevance and chronology disagree.
    const dense = await seedConversation({
      name: 'Dana Okoye',
      at: new Date(Date.now() - 200 * DAY),
      messages: [`${term} ${term} ${term} ${term} ${term} broke the export again`],
    })
    const fresh = await seedConversation({
      name: 'Priya Raman',
      at: new Date(),
      messages: [`a passing mention of ${term}`],
    })

    // Pinning nothing keeps relevance in charge.
    expect(await searchOrder(term, [dense, fresh])).toEqual([dense, fresh])
    // Pinning a sort makes the list chronological again — the way to find the
    // earliest report of a recurring problem among the matches.
    expect(await searchOrder(term, [dense, fresh], 'oldest')).toEqual([dense, fresh])
    expect(await searchOrder(term, [dense, fresh], 'recent')).toEqual([fresh, dense])
  })

  it('falls back to the activity order when relevance is pinned without a term', async () => {
    const older = await seedConversation({
      name: 'Dana Okoye',
      at: new Date(Date.now() - 5 * DAY),
      messages: ['first'],
    })
    const newer = await seedConversation({
      name: 'Priya Raman',
      at: new Date(),
      messages: ['second'],
    })

    const page = await listConversationsForAgent({ sort: 'relevance', limit: 50 }, AGENT)
    const seen = new Set<string>([older, newer])
    expect(page.conversations.map((c) => c.id).filter((id) => seen.has(id))).toEqual([newer, older])
  })

  it('pages a pinned-sort search without duplicating or skipping a row', async () => {
    const term = `craddock${suffix().replace(/[^a-z0-9]/g, '')}`
    const ids: ConversationId[] = []
    // Ascending age, so the expected 'oldest' order is the reverse of seed order.
    for (let i = 0; i < 4; i++) {
      ids.push(
        await seedConversation({
          name: `Case ${i}`,
          at: new Date(Date.now() - i * DAY),
          messages: [`${`${term} `.repeat(6 - i)}about the account`],
        })
      )
    }
    const expected = [...ids].reverse()

    const collected: ConversationId[] = []
    let before: ConversationId | undefined
    for (let guard = 0; guard < 6; guard++) {
      const page = await listConversationsForAgent(
        { search: term, sort: 'oldest', limit: 2, before },
        AGENT
      )
      collected.push(...page.conversations.map((c) => c.id as ConversationId))
      if (!page.hasMore) break
      before = page.nextCursor as ConversationId
    }
    const known = new Set<string>(ids)
    expect(collected.filter((id) => known.has(id))).toEqual(expected)
  })

  it('pages a relevance-ordered search without duplicating or skipping a row', async () => {
    const term = `snorfle${suffix().replace(/[^a-z0-9]/g, '')}`
    const ids: ConversationId[] = []
    // Descending keyword density, so the expected relevance order is the seed order.
    for (let i = 0; i < 4; i++) {
      ids.push(
        await seedConversation({
          name: `Case ${i}`,
          at: new Date(Date.now() - i * DAY),
          messages: [`${`${term} `.repeat(6 - i)}about the account`],
        })
      )
    }
    const expected = await searchOrder(term, ids)
    expect(expected).toHaveLength(4)

    const collected: ConversationId[] = []
    let before: ConversationId | undefined
    for (let guard = 0; guard < 6; guard++) {
      const page = await listConversationsForAgent({ search: term, limit: 2, before }, AGENT)
      collected.push(...page.conversations.map((c) => c.id as ConversationId))
      if (!page.hasMore) break
      before = page.nextCursor as ConversationId
    }
    expect(collected).toEqual(expected)
  })
})
