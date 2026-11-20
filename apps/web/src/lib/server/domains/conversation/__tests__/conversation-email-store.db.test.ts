/**
 * The outbound Message-ID store against a real database. A reply is matched to
 * its conversation whatever case it quotes our ids in, but the In-Reply-To and
 * References of the next email repeat each id exactly as it went out: a mail
 * client that compares ids exactly would otherwise lose the thread.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, principal } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  recordOutboundEmail,
  resolveConversationByMessageIds,
  threadIdsForOutbound,
} from '../conversation.email-store'

const fixture = await createDbTestFixture()

async function seedConversation(): Promise<ConversationId> {
  const visitor = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: visitor, type: 'user', role: 'user', createdAt: new Date() })
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor, channel: 'email' })
    .returning()
  return row!.id as ConversationId
}

describe.skipIf(!fixture.available)('outbound Message-IDs (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('repeats each id in the next email exactly as it was sent', async () => {
    const conversationId = await seedConversation()
    const first = `c.${conversationId}.Ab3_Xy-Q9@Acme.test`
    const second = `c.${conversationId}.zZ9-kL_m2@Acme.test`
    await recordOutboundEmail(`<${first}>`, conversationId)
    await recordOutboundEmail(`<${second}>`, conversationId)

    // Both rows share one transaction's clock here, so compare as sets.
    const thread = await threadIdsForOutbound(conversationId)
    expect([...thread.outbound].sort()).toEqual([first, second].sort())
    expect([...thread.merged].sort()).toEqual([first, second].sort())
  })

  it('still matches a reply that quotes our id in another case', async () => {
    const conversationId = await seedConversation()
    const sent = `c.${conversationId}.Ab3_Xy-Q9@Acme.test`
    await recordOutboundEmail(sent, conversationId)

    expect(await resolveConversationByMessageIds([`<${sent}>`])).toBe(conversationId)
    expect(await resolveConversationByMessageIds([sent.toLowerCase()])).toBe(conversationId)
    expect(await resolveConversationByMessageIds([sent.toUpperCase()])).toBe(conversationId)
  })
})
