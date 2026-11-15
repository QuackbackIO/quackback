/**
 * One resolution reads the send guard's context once, however many candidate
 * addresses it tries. The context loads every verified domain from the
 * database, and resolution runs on every outbound email, so reading it per
 * candidate would turn one send into a query per step.
 *
 * Also the platform inbox steps, which need a workspace mail slug the database
 * suite cannot give them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'

const contexts = vi.fn()

vi.mock('../outbound-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../outbound-identity')>()
  return {
    ...actual,
    sendingIdentityContext: async () => {
      contexts()
      return {
        verifiedDomains: ['live.example'],
        platformFrom: 'Platform <noreply@platform.example>',
        inboundDomain: 'in.platform.example',
        mailSlug: 'acme',
        pooled: true,
      }
    },
  }
})

vi.mock('@/lib/server/domains/conversation/conversation.mail-slug', () => ({
  currentMailSlug: () => 'acme',
}))
vi.mock('@/lib/server/domains/conversation/conversation.email-channel', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/conversation/conversation.email-channel')
  >()),
  platformInboxAddress: (slug: string | null) => (slug ? `${slug}@in.platform.example` : null),
}))

const conversationRow = vi.hoisted(() => ({
  current: null as null | { channelAccountId: string | null; threadSenderAddress: string | null },
}))
vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => (conversationRow.current ? [conversationRow.current] : []),
  }
  return { ...actual, db: { select: () => chain } }
})

const account = (address: string) => ({ id: `ca_${address}`, address, senderName: null })
const senders = vi.hoisted(() => ({ current: new Map<string, unknown>() }))
const inboundAccount = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('../email-senders', () => ({
  getEmailSenders: async () => senders.current,
  // Every address asked about is one the workspace still has.
  workspaceAddress: async () => ({ known: true, senderName: null }),
}))
vi.mock('../channel-account.service', () => ({
  getChannelAccount: async () => inboundAccount.current,
}))

const { resolveConversationSender, resolveSender } = await import('../sender-resolver')

beforeEach(() => {
  contexts.mockClear()
  conversationRow.current = null
  inboundAccount.current = null
  senders.current = new Map()
})

describe('resolveSender', () => {
  it('reads the guard context once across every candidate it tries', async () => {
    conversationRow.current = {
      channelAccountId: 'ca_route',
      threadSenderAddress: 'a@gone.example',
    }
    inboundAccount.current = { address: null, config: { forwardingTarget: 'b@pending.example' } }
    senders.current = new Map<string, unknown>([
      ['support', { mode: 'inbox', account: null }],
      ['default', { mode: 'address', account: account('c@pending.example') }],
    ])
    // Thread, inbox and default refused, then the platform inbox: four candidates.
    const resolved = await resolveSender({ conversationId: 'conversation_1' as ConversationId })
    expect(resolved).toEqual({
      from: 'acme@in.platform.example',
      source: 'platform_inbox',
      senderName: null,
    })
    expect(contexts).toHaveBeenCalledTimes(1)
  })

  it('reads it once even when nothing is permitted', async () => {
    senders.current = new Map<string, unknown>([
      ['changelog', { mode: 'address', account: account('a@pending.example') }],
      ['default', { mode: 'address', account: account('b@pending.example') }],
    ])
    expect(await resolveSender({ surface: 'changelog' })).toBeNull()
    expect(contexts).toHaveBeenCalledTimes(1)
  })

  it('prefers the default to the platform inbox on a front-door thread in inbox mode', async () => {
    conversationRow.current = { channelAccountId: 'ca_route', threadSenderAddress: null }
    inboundAccount.current = { address: null, config: {} }
    senders.current = new Map<string, unknown>([
      ['support', { mode: 'inbox', account: null }],
      ['default', { mode: 'address', account: account('hello@live.example') }],
    ])
    expect(await resolveSender({ conversationId: 'conversation_1' as ConversationId })).toEqual({
      from: 'hello@live.example',
      source: 'default',
      senderName: null,
    })
  })

  it('never uses the platform inbox outside inbox mode', async () => {
    conversationRow.current = { channelAccountId: 'ca_route', threadSenderAddress: null }
    inboundAccount.current = { address: null, config: { forwardingTarget: 'b@pending.example' } }
    expect(await resolveSender({ conversationId: 'conversation_1' as ConversationId })).toBeNull()
  })
})

describe('resolveConversationSender', () => {
  it('does not store the platform inbox, so the thread moves once its own address can send', async () => {
    // The database double has no update: storing anything here would throw.
    conversationRow.current = { channelAccountId: 'ca_route', threadSenderAddress: null }
    inboundAccount.current = { address: null, config: { forwardingTarget: 'b@pending.example' } }
    senders.current = new Map<string, unknown>([['support', { mode: 'inbox', account: null }]])
    expect(await resolveConversationSender('conversation_1' as ConversationId)).toEqual({
      from: 'acme@in.platform.example',
      source: 'platform_inbox',
      senderName: null,
    })
  })
})
