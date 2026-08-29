import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ConversationId, ConversationMessageId, PrincipalId } from '@quackback/ids'

const lookup = vi.hoisted(() => vi.fn())
const findFirst = vi.hoisted(() => vi.fn())
const warn = vi.hoisted(() => vi.fn())
const persist = vi.hoisted(() => vi.fn(async () => {}))
const recordLastError = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/lib/server/domains/conversation/conversation.inbound-resolve', () => ({
  lookupChannelThreadByConversation: lookup,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ config: { integrationId: 'integration_1' } }],
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
    query: {
      integrations: { findFirst: findFirst },
    },
    update: () => ({ set: () => ({ where: async () => [] }) }),
  },
  eq: () => ({}),
  and: () => ({}),
  desc: () => ({}),
  isNull: () => ({}),
  conversationMessages: { id: 'id', metadata: 'metadata' },
  channelAccounts: { id: 'id', config: 'config' },
  integrations: { id: 'id', integrationType: 'integrationType', status: 'status' },
}))

vi.mock('@/lib/server/integrations/encryption', () => ({
  decryptSecrets: () => ({ accessToken: 'tok' }),
}))

vi.mock('@/lib/server/markdown-tiptap', () => ({
  contentJsonToMarkdown: (_json: unknown, content: string) => content,
}))

vi.mock('@/lib/server/domains/conversation/conversation.channel-delivery', () => ({
  persistChannelDelivery: persist,
}))

vi.mock('@/lib/server/integrations/webhook-registration', () => ({
  recordIntegrationLastError: recordLastError,
}))

import {
  deleteGitHubIssueComment,
  deliverGitHubAgentMessage,
  deliverGitHubLifecycleComment,
  retryGitHubAgentMessage,
} from '../github-deliver'
import { githubAdapter } from '../github'

const conversationId = 'conversation_01kw8qxn1eeh4t2rek7varh032' as ConversationId
const fanoutConversationId = 'conversation_01kw8qxn1eeh4t2rek7varh099' as ConversationId
const noThreadConversationId = 'conversation_01kw8qxn1eeh4t2rek7varh0aa' as ConversationId
const noTokenConversationId = 'conversation_01kw8qxn1eeh4t2rek7varh0bb' as ConversationId
const fallbackConversationId = 'conversation_01kw8qxn1eeh4t2rek7varh0cc' as ConversationId

function agentCtx(id: ConversationId, messageId?: string) {
  return {
    conversationId: id,
    messageId: (messageId ?? `${id}-msg`) as ConversationMessageId,
    visitorPrincipalId: 'principal_1' as PrincipalId,
    content: 'the fix is out',
    contentJson: null,
    agentName: 'Alex',
    recipient: '',
    ctaUrl: '',
    workspaceName: 'Acme',
    logoUrl: null,
    direction: 'agent_reply' as const,
  }
}

describe('github adapter delivery', () => {
  beforeEach(() => {
    lookup.mockResolvedValue({
      channelAccountId: 'channelaccount_1',
      externalThreadKey: 'acme/api#201',
    })
    findFirst.mockResolvedValue({ id: 'integration_1', secrets: 'enc' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('POSTs an issue comment for an agent reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 444 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await deliverGitHubAgentMessage(agentCtx(conversationId))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/acme/api/issues/201/comments')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.body).toBe('the fix is out')
    expect(persist).toHaveBeenCalledWith(expect.anything(), {
      status: 'sent',
      channel: 'github',
      externalId: '444',
      error: undefined,
    })
  })

  it('PATCHes the GitHub issue closed on lifecycle close, without commenting', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 201, state: 'closed' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await deliverGitHubLifecycleComment('closed', { conversationId })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/acme/api/issues/201')
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({ state: 'closed' })
  })

  it('PATCHes the GitHub issue open on lifecycle reopen', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 201, state: 'open' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await deliverGitHubLifecycleComment('reopened', { conversationId })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({ state: 'open' })
  })

  it('posts exactly one comment when notify fans out twice in one invocation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 446 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = agentCtx(fanoutConversationId)
    await deliverGitHubAgentMessage(ctx)
    await deliverGitHubAgentMessage({
      ...ctx,
      visitorPrincipalId: 'principal_2' as PrincipalId,
      recipient: 'cc@example.com',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not POST when there is no channel thread', async () => {
    lookup.mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await deliverGitHubAgentMessage(agentCtx(noThreadConversationId))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      { conversation_id: noThreadConversationId },
      'unreachable on GitHub: no channel thread'
    )
    expect(persist).toHaveBeenCalledWith(expect.anything(), {
      status: 'failed',
      channel: 'github',
      externalId: undefined,
      error: 'This conversation is not linked to a GitHub issue.',
    })
  })

  it('falls back to the active GitHub integration when the linked row has no token', async () => {
    findFirst
      .mockResolvedValueOnce({ secrets: null })
      .mockResolvedValueOnce({ id: 'integration_1', secrets: 'enc' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 447 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await deliverGitHubAgentMessage(agentCtx(fallbackConversationId))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not POST when the integration has no access token', async () => {
    findFirst.mockResolvedValue({ secrets: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await deliverGitHubAgentMessage(agentCtx(noTokenConversationId))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      { conversation_id: noTokenConversationId },
      'unreachable on GitHub: no access token'
    )
    expect(persist).toHaveBeenCalledWith(expect.anything(), {
      status: 'failed',
      channel: 'github',
      externalId: undefined,
      error: 'GitHub is not connected.',
    })
  })

  it('marks the message failed when GitHub rejects the comment', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad token',
    })
    vi.stubGlobal('fetch', fetchMock)
    const failedId = 'conversation_01kw8qxn1eeh4t2rek7varh0dd' as ConversationId
    await expect(deliverGitHubAgentMessage(agentCtx(failedId))).rejects.toThrow(
      /Authentication failed/
    )
    expect(persist).toHaveBeenCalledWith(expect.anything(), {
      status: 'failed',
      channel: 'github',
      externalId: undefined,
      error: 'Authentication failed. Please reconnect GitHub.',
    })
    expect(recordLastError).toHaveBeenCalledWith(
      'integration_1',
      'Authentication failed. Please reconnect GitHub.'
    )
  })

  it('retry POSTs the comment again after a failed send', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'bad token' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 888 }) })
    vi.stubGlobal('fetch', fetchMock)
    const retryId = 'conversation_01kw8qxn1eeh4t2rek7varh0ee' as ConversationId
    const ctx = agentCtx(retryId)
    await expect(deliverGitHubAgentMessage(ctx)).rejects.toThrow(/Authentication failed/)
    await retryGitHubAgentMessage(ctx)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenCalledWith(expect.anything(), {
      status: 'pending',
      channel: 'github',
    })
    expect(persist).toHaveBeenCalledWith(expect.anything(), {
      status: 'sent',
      channel: 'github',
      externalId: '888',
      error: undefined,
    })
  })

  it('retry throws when the conversation is not linked to an issue', async () => {
    lookup.mockResolvedValue(null)
    const retryId = 'conversation_01kw8qxn1eeh4t2rek7varh0ff' as ConversationId
    await expect(retryGitHubAgentMessage(agentCtx(retryId))).rejects.toThrow(
      /not linked to a GitHub issue/
    )
    expect(persist).toHaveBeenCalledWith(expect.anything(), {
      status: 'failed',
      channel: 'github',
      externalId: undefined,
      error: 'This conversation is not linked to a GitHub issue.',
    })
  })

  it('DELETEs a GitHub issue comment', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    await deleteGitHubIssueComment(conversationId, '444')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/acme/api/issues/comments/444')
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('treats a 404 on comment DELETE as success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'gone',
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(deleteGitHubIssueComment(conversationId, '9')).resolves.toBeUndefined()
  })

  it('records lastError when a close PATCH is 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad token',
    })
    vi.stubGlobal('fetch', fetchMock)
    const closeId = 'conversation_01kw8qxn1eeh4t2rek7varh0gg' as ConversationId
    await expect(
      deliverGitHubLifecycleComment('closed', { conversationId: closeId })
    ).rejects.toThrow(/Authentication failed/)
    expect(recordLastError).toHaveBeenCalledWith(
      'integration_1',
      'Authentication failed. Please reconnect GitHub.'
    )
  })

  it('CSAT is a no-op', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await githubAdapter.deliverCsatRequest({
      conversationId,
      visitorPrincipalId: 'principal_1' as PrincipalId,
      recipient: '',
      promptText: 'How did we do?',
      ratingUrls: ['1', '2', '3', '4', '5'] as [string, string, string, string, string],
      workspaceName: 'Acme',
      logoUrl: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
