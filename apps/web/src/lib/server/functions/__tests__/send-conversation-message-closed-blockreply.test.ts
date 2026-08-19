/**
 * SF3: sendConversationMessageFn's "prevent replies to closed conversations"
 * gate (§4.3, opt-in via messenger.preventRepliesWhenClosed) must not reject
 * a visitor send that carries a genuinely MATCHED blockReply on an
 * already-closed conversation — that's the intended post-close CSAT/button
 * flow, not the customer trying to reopen the thread. An unmatched/forged
 * blockReply (or no blockReply at all) must still be refused exactly as
 * before this fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// createServerFn → directly-callable fns (mirrors sla-policies.fn.test.ts /
// workflows-class-guard.test.ts), with the real zod validator applied.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _schema: { parse: (v: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler({ data: _schema ? _schema.parse(args?.data) : args?.data })
    }
    fn.validator = (schema: { parse: (v: unknown) => unknown }) => {
      _schema = schema
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isConversationsEnabled: vi.fn(),
  resolvePortalAccessForRequest: vi.fn(),
  isBlocked: vi.fn(),
  getMessengerConfig: vi.fn(),
  getConversationForVisitor: vi.fn(),
  resolveVisitorBlockReply: vi.fn(),
  sendVisitorMessage: vi.fn(),
  assertConversationSendRate: vi.fn(),
  policyActorFromAuth: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
  assertPermission: vi.fn(),
  getOptionalAuth: vi.fn(),
  hasAuthCredentials: vi.fn(),
}))
vi.mock('@/lib/shared/roles', () => ({
  isTeamMember: () => false, // exercise the visitor-only ingress branch
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: hoisted.isConversationsEnabled,
}))
vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: hoisted.resolvePortalAccessForRequest,
}))
vi.mock('@/lib/server/domains/principals/blocking', () => ({ isBlocked: hoisted.isBlocked }))
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getMessengerConfig: hoisted.getMessengerConfig,
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  getConversationForVisitor: hoisted.getConversationForVisitor,
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  resolveVisitorBlockReply: hoisted.resolveVisitorBlockReply,
  sendVisitorMessage: hoisted.sendVisitorMessage,
}))
vi.mock('@/lib/server/domains/conversation/conversation.ratelimit', () => ({
  assertConversationSendRate: hoisted.assertConversationSendRate,
}))

import { sendConversationMessageFn } from '../conversation'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({
    principal: { id: 'principal_visitor', role: 'user' },
    user: { name: 'Vis', image: null, email: 'v@example.com' },
  })
  hoisted.isConversationsEnabled.mockResolvedValue(true)
  hoisted.resolvePortalAccessForRequest.mockResolvedValue({ granted: true })
  hoisted.isBlocked.mockResolvedValue(false)
  hoisted.assertConversationSendRate.mockResolvedValue(undefined)
  hoisted.policyActorFromAuth.mockResolvedValue({
    principalId: 'principal_visitor',
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(),
  })
  hoisted.getMessengerConfig.mockResolvedValue({ preventRepliesWhenClosed: true })
  hoisted.sendVisitorMessage.mockResolvedValue({
    conversation: { id: 'conversation_1' },
    message: {},
  })
})

const baseData = {
  conversationId: 'conversation_1',
  content: '',
}

describe('sendConversationMessageFn: prevent-replies-when-closed carve-out (SF3)', () => {
  it('rejects an ordinary reply (no blockReply) to a closed conversation when the setting is on', async () => {
    hoisted.getConversationForVisitor.mockResolvedValue({ conversation: { status: 'closed' } })
    await expect(
      sendConversationMessageFn({ data: { ...baseData, content: 'hi again' } })
    ).rejects.toThrow(/closed/i)
    expect(hoisted.sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('rejects a blockReply that does not actually match (resolveVisitorBlockReply returns null) — same as no blockReply', async () => {
    hoisted.getConversationForVisitor.mockResolvedValue({ conversation: { status: 'closed' } })
    hoisted.resolveVisitorBlockReply.mockResolvedValue(null)
    await expect(
      sendConversationMessageFn({
        data: {
          ...baseData,
          blockReply: {
            kind: 'buttons',
            inReplyToMessageId: 'conversation_message_ghost',
            buttonKey: 'yes',
          },
        },
      })
    ).rejects.toThrow(/closed/i)
    expect(hoisted.sendVisitorMessage).not.toHaveBeenCalled()
  })

  it('accepts a MATCHED blockReply on a closed conversation instead of rejecting it', async () => {
    hoisted.getConversationForVisitor.mockResolvedValue({ conversation: { status: 'closed' } })
    hoisted.resolveVisitorBlockReply.mockResolvedValue({
      content: 'Yes please',
      metadata: {
        blockReply: { kind: 'buttons', inReplyToMessageId: 'conversation_message_block1' },
      },
    })
    await expect(
      sendConversationMessageFn({
        data: {
          ...baseData,
          blockReply: {
            kind: 'buttons',
            inReplyToMessageId: 'conversation_message_block1',
            buttonKey: 'yes',
          },
        },
      })
    ).resolves.toBeDefined()
    expect(hoisted.sendVisitorMessage).toHaveBeenCalledTimes(1)
  })

  it('never even resolves the blockReply for an OPEN conversation — the gate short-circuits on status first', async () => {
    hoisted.getConversationForVisitor.mockResolvedValue({ conversation: { status: 'open' } })
    await sendConversationMessageFn({
      data: {
        ...baseData,
        blockReply: {
          kind: 'buttons',
          inReplyToMessageId: 'conversation_message_block1',
          buttonKey: 'yes',
        },
      },
    })
    expect(hoisted.resolveVisitorBlockReply).not.toHaveBeenCalled()
    expect(hoisted.sendVisitorMessage).toHaveBeenCalledTimes(1)
  })

  it('is unaffected when the setting is off: a closed conversation accepts an ordinary reply and reopens through sendVisitorMessage as usual', async () => {
    hoisted.getMessengerConfig.mockResolvedValue({ preventRepliesWhenClosed: false })
    hoisted.getConversationForVisitor.mockResolvedValue({ conversation: { status: 'closed' } })
    await expect(
      sendConversationMessageFn({ data: { ...baseData, content: 'hi again' } })
    ).resolves.toBeDefined()
    expect(hoisted.sendVisitorMessage).toHaveBeenCalledTimes(1)
  })
})
