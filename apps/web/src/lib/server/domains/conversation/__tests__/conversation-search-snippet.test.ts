/**
 * Real-DB coverage for the inbox search results' keyword-in-context excerpts.
 * A searched row has to say WHY it matched, so `loadConversationSearchSnippets`
 * resolves, per conversation, the message the term actually occurs in — which
 * is rarely the newest one the list preview shows. Runs inside the
 * db-test-fixture rollback transaction (see server/__tests__/README.md).
 *
 * Every case searches an invented term, so the assertions describe only the
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
import { conversations, conversationMessages, principal, user } from '@/lib/server/db'
import type { TermSegment } from '@/lib/shared/utils/keyword-context'
import { loadConversationSearchSnippets } from '../conversation.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const text = (segments: TermSegment[] | undefined) => segments?.map((s) => s.text).join('')
const marks = (segments: TermSegment[] | undefined) =>
  segments?.filter((s) => s.match).map((s) => s.text)

/** Seed one conversation with its messages, oldest first (a minute apart). */
async function seedConversation(
  messages: { content: string; internal?: boolean; deleted?: boolean }[]
): Promise<ConversationId> {
  const userId = createId('user') as UserId
  const visitorPrincipalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Snippet Visitor' })
  await testDb.insert(principal).values({
    id: visitorPrincipalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Snippet Visitor',
    createdAt: new Date(),
  })
  const id = createId('conversation') as ConversationId
  await testDb.insert(conversations).values({ id, visitorPrincipalId, channel: 'messenger' })
  for (let i = 0; i < messages.length; i++) {
    await testDb.insert(conversationMessages).values({
      conversationId: id,
      principalId: visitorPrincipalId,
      senderType: 'visitor',
      content: messages[i].content,
      isInternal: messages[i].internal ?? false,
      deletedAt: messages[i].deleted ? new Date() : null,
      createdAt: new Date(Date.now() - (messages.length - i) * 60_000),
    })
  }
  return id
}

describe.skipIf(!fixture.available)('inbox search snippets (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('excerpts the message the term occurs in, not the newest one', async () => {
    const term = 'zorbex'
    const id = await seedConversation([
      { content: `Our nightly ${term} export keeps timing out after 30 seconds.` },
      { content: 'Thanks, that is all sorted now.' },
    ])

    const snippets = await loadConversationSearchSnippets([id], term)

    expect(text(snippets.get(id))).toBe(
      `Our nightly ${term} export keeps timing out after 30 seconds.`
    )
    expect(marks(snippets.get(id))).toEqual([term])
  })

  it('prefers the most recent matching message when several match', async () => {
    const term = 'quillex'
    const id = await seedConversation([
      { content: `First mention of ${term} here.` },
      { content: `Latest mention of ${term} here.` },
    ])

    expect(text((await loadConversationSearchSnippets([id], term)).get(id))).toBe(
      `Latest mention of ${term} here.`
    )
  })

  it('never excerpts a deleted message', async () => {
    const term = 'vandril'
    const id = await seedConversation([
      { content: `Kept message about ${term} handling.` },
      { content: `Retracted message about ${term} handling.`, deleted: true },
    ])

    expect(text((await loadConversationSearchSnippets([id], term)).get(id))).toBe(
      `Kept message about ${term} handling.`
    )
  })

  it('excerpts an internal note, which the list search also matches on', async () => {
    const term = 'brindle'
    const id = await seedConversation([
      { content: 'Customer says the page is blank.' },
      { content: `Internal: escalated to the ${term} team.`, internal: true },
    ])

    expect(marks((await loadConversationSearchSnippets([id], term)).get(id))).toEqual([term])
  })

  it('has no entry for a conversation whose messages never mention the term', async () => {
    const id = await seedConversation([{ content: 'Nothing relevant in here.' }])

    expect((await loadConversationSearchSnippets([id], 'grellow')).has(id)).toBe(false)
  })

  it('returns an empty map for an empty term or an empty id list', async () => {
    const id = await seedConversation([{ content: 'Anything at all.' }])

    expect((await loadConversationSearchSnippets([id], '   ')).size).toBe(0)
    expect((await loadConversationSearchSnippets([], 'anything')).size).toBe(0)
  })
})
