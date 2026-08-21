/**
 * What the cold-inbound store FILES a message under.
 *
 * The read side of cold-inbound dedupe is exercised through the ingest core; this
 * is the write, and the pair only holds if the two spend the same derivation.
 * The consequence of them drifting apart is the worst one this path has: a cold
 * message opens a THREAD rather than appending to one, so a redelivery that
 * fails to match the row it should have matched does not duplicate a message, it
 * opens a second conversation with a second first-contact notification. The edge
 * bridge redelivers a whole message when any one of its recipients faults, so
 * that is an ordinary event rather than a rare one.
 *
 * The db is a recorder rather than a stub: the values the insert actually bound
 * are what is asserted, so a store that stopped stamping the key — or stamped a
 * different one — fails here rather than passing on a read-side test that never
 * exercised it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ChannelAccountId, PrincipalId } from '@quackback/ids'
import { parseRawEmail, type ParsedInboundEmail } from '../conversation.email-inbound'

/** Every row the store inserted, in order, keyed by nothing but its shape. */
let insertedMessages: Array<Record<string, unknown>> = []
let insertedConversations: Array<Record<string, unknown>> = []

vi.mock('@/lib/server/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/db')>()
  // Which table an insert names is read off the module's own exports, so the
  // recorder cannot be fooled by argument order.
  const tx = {
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          const into =
            table === original.conversationMessages ? insertedMessages : insertedConversations
          into.push(row)
          return [{ id: 'conversation_new', ...row, createdAt: new Date() }]
        },
      }),
    }),
  }
  return {
    ...original,
    db: {
      ...tx,
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  }
})

// The store fires two domain events after it commits. Neither is what this file
// is about, and both reach the whole event bridge.
vi.mock('../conversation.webhooks', () => ({
  emitConversationCreated: vi.fn(async () => {}),
  emitMessageCreated: vi.fn(async () => {}),
}))

// Imported at module scope by the store for the sender-resolution half of the
// module, which this file never calls.
vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  createPrincipal: vi.fn(),
  ensurePrincipalForUser: vi.fn(),
}))

const routeUnassignedConversation = vi.fn(async (_conversation: unknown) => null)
vi.mock('../conversation.service', () => ({
  routeUnassignedConversation: (conversation: unknown) => routeUnassignedConversation(conversation),
}))

import { createEmailConversation } from '../conversation.email-cold-inbound'

const RAW = (headers: string[]): string =>
  [
    'To: support@customer.example',
    'From: Stranger <stranger@example.com>',
    'Subject: Hello',
    ...headers,
    '',
    'Is anyone there?',
    '',
  ].join('\r\n')

function store(parsed: ParsedInboundEmail): Promise<unknown> {
  return createEmailConversation({
    parsed,
    channelAccountId: 'channel_account_1' as ChannelAccountId,
    principalId: 'principal_lead' as PrincipalId,
    unverified: true,
    content: 'Is anyone there?',
  })
}

const filedKey = (): unknown =>
  (insertedMessages[0]!.metadata as { emailMessageId?: unknown }).emailMessageId

beforeEach(() => {
  insertedMessages = []
  insertedConversations = []
  routeUnassignedConversation.mockClear()
})

describe('the key a cold-inbound message is filed under', () => {
  it('is the transport id, namespaced, for a message with no Message-ID', async () => {
    // THE ONE THAT MATTERS. The ingest core looks this exact key up before it
    // opens a thread, so a store that filed `parsed.messageId` here would write
    // nothing at all and every redelivery of a Message-ID-less cold email would
    // open a second conversation.
    const parsed = parseRawEmail(RAW([]))
    expect(parsed.messageId).toBeNull()
    parsed.transportMessageId = 'ses-cold-1'

    await store(parsed)

    expect(insertedMessages).toHaveLength(1)
    expect(filedKey()).toBe('qb-transport:ses-cold-1')
  })

  it('is the message’s own id, unprefixed, whenever it has one', async () => {
    // Unchanged and unprefixed: that is what every row ingested before the
    // fallback existed is filed under, and what the lookup spends first.
    const parsed = parseRawEmail(RAW(['Message-ID: <cold-1@example.com>']))
    parsed.transportMessageId = 'ses-cold-1'

    await store(parsed)

    expect(filedKey()).toBe('<cold-1@example.com>')
  })

  it('routes an accepted cold-inbound conversation like a widget start', async () => {
    await store(parseRawEmail(RAW(['Message-ID: <cold-route@example.com>'])))
    expect(routeUnassignedConversation).toHaveBeenCalledTimes(1)
    expect(routeUnassignedConversation).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'email' })
    )
  })

  it('does not route quarantined mail', async () => {
    await createEmailConversation({
      parsed: parseRawEmail(RAW(['Message-ID: <spam@example.com>'])),
      channelAccountId: 'channel_account_1' as ChannelAccountId,
      principalId: 'principal_lead' as PrincipalId,
      unverified: true,
      content: 'spam',
      quarantine: { cause: 'sender_auth_reject', note: 'refused' },
    })
    expect(routeUnassignedConversation).not.toHaveBeenCalled()
  })

  it('is absent when the message offers no id at all', async () => {
    // As undeduplicable as it has always been, and stamping something invented
    // would be worse: two unrelated messages would collide in the unique index.
    await store(parseRawEmail(RAW([])))

    expect(filedKey()).toBeUndefined()
  })
})
