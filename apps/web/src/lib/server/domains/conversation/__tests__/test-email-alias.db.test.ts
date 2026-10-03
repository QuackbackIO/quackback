/**
 * A teammate's test alias, `<slug>+test-<token>@<inbound domain>`. Mail to it
 * belongs to that teammate's test customer whoever sends it; the same teammate
 * writing to the ordinary workspace address is a real customer conversation.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'

process.env.BASE_URL = 'https://quackback.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)
process.env.EMAIL_INBOUND_DOMAIN = 'tenaevexeo.resend.app'
process.env.EMAIL_INBOUND_SIGNING_SECRET = 'whsec_dGVzdHNlY3JldA=='

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, principal, user, eq } from '@/lib/server/db'
import type { ParsedInboundEmail } from '../conversation.email-inbound'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('../conversation.webhooks', async (orig) => ({
  ...(await orig<typeof import('../conversation.webhooks')>()),
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageCreated: vi.fn().mockResolvedValue(undefined),
  emitConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: vi.fn().mockResolvedValue({ count: 1 }),
  incrementBuckets: vi.fn().mockResolvedValue([1]),
  bucketRetryAfter: vi.fn().mockResolvedValue(60),
}))
const ack = vi.hoisted(() => vi.fn())
vi.mock('../conversation.auto-ack', () => ({ maybeSendColdInboundAck: ack }))

import { ingestParsedEmail } from '../conversation.email-inbound.service'
import { testEmailAlias } from '../conversation.email-channel'
import { mailSlugFor, withWorkspace } from '@/lib/server/__tests__/workspace-scope'
import { testOwnerOf } from '@/lib/server/test-data'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ owner: principal.testOwnerPrincipalId }).from(principal).limit(0)
  },
})

const WORKSPACE = 'live-t1'
const SLUG = mailSlugFor(WORKSPACE)
const PLATFORM_ADDRESS = `${SLUG}@tenaevexeo.resend.app`
const asWorkspace = <T>(fn: () => T): T => withWorkspace(WORKSPACE, fn)
const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const mail = (to: string, from: string): ParsedInboundEmail => ({
  toAddresses: [to],
  ccAddresses: [],
  replyToAddresses: [],
  from,
  subject: 'Testing the inbox',
  text: 'Hi! Is anyone there?',
  messageId: `<${suffix()}@example.com>`,
  emailId: null,
  inReplyTo: null,
  references: [],
  autoSubmitted: null,
  autoResponseSuppress: null,
  precedence: null,
  hasListHeaders: false,
  authenticationResults: 'mx; spf=pass; dmarc=pass (p=reject) header.from=example.com',
})

let owner: PrincipalId

async function ingest(to: string, from: string) {
  const res = await asWorkspace(() => ingestParsedEmail(mail(to, from)))
  expect(res.status).toBe('ingested')
  if (res.status !== 'ingested') throw new Error(res.status)
  const [row] = await testDb
    .select()
    .from(conversations)
    .where(eq(conversations.id, res.conversationId))
  return { row, testOwner: await testOwnerOf(row.visitorPrincipalId) }
}

describe.skipIf(!fixture.available)('the test email alias (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    ack.mockReset()
    owner = createId('principal') as PrincipalId
    const uid = createId('user') as UserId
    await testDb.insert(user).values({ id: uid, name: 'Acme', email: 'you@example.com' })
    await testDb
      .insert(principal)
      .values({ id: owner, userId: uid, role: 'admin', type: 'user', createdAt: new Date() })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('files mail from the teammate to their alias as their test customer, assigned to them', async () => {
    const alias = testEmailAlias(owner, SLUG)!
    const { row, testOwner } = await ingest(alias, 'you@example.com')
    expect(testOwner).toBe(owner)
    expect(row.assignedAgentPrincipalId).toBe(owner)
    expect(row.visitorEmail).toBeNull()
    expect(ack).not.toHaveBeenCalled()
  })

  it("keeps an outsider's mail to the alias test, and still the teammate's", async () => {
    const alias = testEmailAlias(owner, SLUG)!
    const { row, testOwner } = await ingest(alias, 'stranger@example.org')
    expect(testOwner).toBe(owner)
    expect(row.visitorEmail).toBeNull()
  })

  it('keeps the teammate writing to the ordinary workspace address real', async () => {
    const { row, testOwner } = await ingest(PLATFORM_ADDRESS, 'you@example.com')
    expect(testOwner).toBeNull()
    expect(row.visitorPrincipalId).toBe(owner)
  })

  it('treats a wrong token as ordinary mail to the workspace address', async () => {
    const forged = `${SLUG}+test-${'0'.repeat(20)}@tenaevexeo.resend.app`
    const { testOwner } = await ingest(forged, 'stranger@example.org')
    expect(testOwner).toBeNull()
  })

  it("stops routing a former teammate's alias", async () => {
    const alias = testEmailAlias(owner, SLUG)!
    await testDb.update(principal).set({ role: 'user' }).where(eq(principal.id, owner))
    const { testOwner } = await ingest(alias, 'stranger@example.org')
    expect(testOwner).toBeNull()
  })
})
