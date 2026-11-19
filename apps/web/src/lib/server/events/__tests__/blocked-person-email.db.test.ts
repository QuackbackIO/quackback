/**
 * No automated email to a blocked person.
 *
 * Blocking someone stops the notices the product sends on its own: ticket
 * confirmations and closes, post updates, mentions, changelog and status
 * announcements, rating requests and the closing notice on an email thread. A
 * teammate's own reply still reaches them: that is the conversation itself.
 *
 * The check runs when the email is sent, on the person the email is for, so a
 * notice queued before the block is still held back.
 *
 * Real database (rolled back per test). The email package is the double: each
 * sender records who it was asked to mail.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'

process.env.BASE_URL ||= 'https://acme.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

const sent = vi.hoisted(() => [] as Array<{ kind: string; to: string }>)
vi.mock('@quackback/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quackback/email')>()
  const record = (kind: string) => async (opts: { to: string }) => {
    sent.push({ kind, to: opts.to })
    return { sent: true }
  }
  return {
    ...actual,
    sendTicketEventEmail: record('ticket'),
    sendStatusChangeEmail: record('post_status'),
    sendNewCommentEmail: record('comment'),
    sendPostMentionEmail: record('mention'),
    sendChangelogPublishedEmail: record('changelog'),
    sendStatusIncidentPublishedEmail: record('status_incident'),
    sendStatusMaintenanceScheduledEmail: record('status_maintenance'),
    sendConversationClosedEmail: record('closed'),
    sendCsatRequestEmail: record('csat'),
  }
})

// Rating links are signed with the server secret, which this suite has no
// need for: any token will do.
vi.mock('@/lib/server/domains/conversation/csat-email-token', () => ({
  mintCsatEmailToken: () => 'csat-token',
}))
vi.mock('@/lib/server/events/hook-context', () => ({
  buildHookContext: async () => ({
    workspaceName: 'Acme',
    portalBaseUrl: 'https://acme.test',
    logoUrl: null,
  }),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isPortalSupportEnabled: async () => true,
  isSupportTicketsEnabled: async () => true,
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  emailBudgetAvailable: async () => true,
  enforceEmailBudget: async () => undefined,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, principal, user } from '@/lib/server/db'
import type { EventData } from '@/lib/server/events/types'
import type { EmailTarget } from '@/lib/server/events/hook-types'
import { emailHook } from '@/lib/server/events/handlers/email'
import { block } from '@/lib/server/domains/principals/blocking'
import { notifyConversationClosed } from '@/lib/server/domains/conversation/conversation.notify-closed'
import { notifyCsatRequestEmail } from '@/lib/server/domains/conversation/conversation.notify'

const fixture = await createDbTestFixture()

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(role: 'admin' | 'user'): Promise<{ id: PrincipalId; email: string }> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  const email = `${role}-${suffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}`, email })
  await testDb.insert(principal).values({ id, userId, role, type: 'user', createdAt: new Date() })
  return { id, email }
}

/** A customer, blocked by a teammate. */
async function blockedCustomer() {
  const teammate = await seedPerson('admin')
  const customer = await seedPerson('user')
  await block(customer.id, teammate.id)
  return customer
}

function event(type: string): EventData {
  return {
    id: `evt_${suffix()}`,
    type,
    timestamp: new Date().toISOString(),
    actor: { type: 'user' },
  } as unknown as EventData
}

const ticketConfig = (kind: string) => ({
  kind,
  workspaceName: 'Acme',
  ticketLabel: '#1',
  title: 'Cannot export',
  ticketId: 'ticket_1',
  ctaUrl: 'https://acme.test/support/conversation_1',
})

function targetFor(person: { id: PrincipalId; email: string }): EmailTarget {
  return {
    email: person.email as EmailTarget['email'],
    unsubscribeUrl: 'https://acme.test/unsubscribe?token=t',
    principalId: person.id,
  }
}

const AUTOMATED: Array<[string, Record<string, unknown>]> = [
  ['ticket.created', ticketConfig('created')],
  ['ticket.status_changed', ticketConfig('status_resolved')],
  [
    'post.status_changed',
    {
      workspaceName: 'Acme',
      postTitle: 'Dark mode',
      postUrl: 'https://acme.test/p/1',
      previousStatus: { name: 'Open', color: '#000' },
      newStatus: { name: 'Planned', color: '#000' },
    },
  ],
  [
    'changelog.published',
    {
      workspaceName: 'Acme',
      changelogTitle: 'November',
      changelogUrl: 'https://acme.test/changelog',
    },
  ],
]

async function seedEmailConversation(visitorPrincipalId: PrincipalId): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id, visitorPrincipalId, channel: 'email', subject: 'Export' })
  return id
}

describe.skipIf(!fixture.available)('no automated email to a blocked person', () => {
  beforeEach(fixture.begin)
  beforeEach(() => {
    sent.length = 0
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('notices sent through the event queue', () => {
    it.each(AUTOMATED)('holds back %s', async (type, config) => {
      const customer = await blockedCustomer()
      const result = await emailHook.run(event(type), targetFor(customer), config)
      expect(result).toEqual({ success: true })
      expect(sent).toEqual([])
    })

    it.each(AUTOMATED)('still sends %s to someone not blocked', async (type, config) => {
      const customer = await seedPerson('user')
      await emailHook.run(event(type), targetFor(customer), config)
      expect(sent.map((s) => s.to)).toEqual([customer.email])
    })

    it("still sends a teammate's reply on a ticket", async () => {
      const customer = await blockedCustomer()
      await emailHook.run(event('ticket.replied'), targetFor(customer), ticketConfig('reply'))
      expect(sent).toEqual([{ kind: 'ticket', to: customer.email }])
    })
  })

  describe('notices on an email conversation', () => {
    it('holds back the closing notice', async () => {
      const customer = await blockedCustomer()
      const conversationId = await seedEmailConversation(customer.id)
      await notifyConversationClosed({ conversationId, variant: 'closed' })
      expect(sent).toEqual([])
    })

    it('sends the closing notice to someone not blocked', async () => {
      const customer = await seedPerson('user')
      const conversationId = await seedEmailConversation(customer.id)
      await notifyConversationClosed({ conversationId, variant: 'closed' })
      expect(sent).toEqual([{ kind: 'closed', to: customer.email }])
    })

    it('holds back the rating request', async () => {
      const customer = await blockedCustomer()
      const conversationId = await seedEmailConversation(customer.id)
      await notifyCsatRequestEmail(conversationId, 'How did we do?')
      expect(sent).toEqual([])
    })

    it('sends the rating request to someone not blocked', async () => {
      const customer = await seedPerson('user')
      const conversationId = await seedEmailConversation(customer.id)
      await notifyCsatRequestEmail(conversationId, 'How did we do?')
      expect(sent).toEqual([{ kind: 'csat', to: customer.email }])
    })
  })
})
