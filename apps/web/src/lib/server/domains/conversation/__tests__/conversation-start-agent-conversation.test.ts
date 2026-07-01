/**
 * startAgentConversation: an AGENT-INITIATED conversation with a portal user.
 * The target becomes the conversation's visitor side, the composing agent is
 * auto-assigned, the first message is agent-typed, and the first message is
 * ALWAYS emailed (no presence check) via notifyConversationStarted. Targets
 * must be identified portal users with a deliverable email — team principals
 * and unreachable visitors are rejected before any write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'

const insertedConversations: Record<string, unknown>[] = []
const insertedMessages: Record<string, unknown>[] = []

const emit = vi.hoisted(() => ({
  emitConversationCreated: vi.fn(),
  emitMessageCreated: vi.fn(),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: vi.fn(),
  emitConversationCsatCommentAdded: vi.fn(),
}))
vi.mock('../conversation.webhooks', () => emit)

const notify = vi.hoisted(() => ({
  notifyVisitorMessage: vi.fn(async () => {}),
  notifyAgentReply: vi.fn(async () => {}),
  notifyConversationStarted: vi.fn(async () => {}),
}))
vi.mock('../conversation.notify', () => notify)

const publish = vi.hoisted(() => ({
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => publish)

vi.mock('../routing', () => ({
  routeConversation: vi.fn(async () => null),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string; status: string }) => ({
    id: c.id,
    status: c.status,
  })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderType: m.senderType,
    content: m.content,
    author: { principalId: m.principalId, displayName: null, avatarUrl: null },
  })),
  authorFromInput: vi.fn((a: { principalId: string }) => ({
    principalId: a.principalId,
    displayName: null,
    avatarUrl: null,
  })),
  resolveAuthor: vi.fn(async (a: { principalId: string }) => ({
    principalId: a.principalId,
    displayName: null,
    avatarUrl: null,
  })),
  loadAuthors: vi.fn(async () => new Map()),
}))

// Mutable target row the principal lookup returns; each test shapes it.
const mocks = vi.hoisted(() => ({
  state: {
    targetRow: null as Record<string, unknown> | null,
  },
}))

vi.mock('@/lib/server/db', () => {
  function chain(label: string) {
    const c: Record<string, unknown> = {}
    c.values = vi.fn((row: Record<string, unknown>) => {
      if (label === 'conversations') insertedConversations.push(row)
      if (label === 'conversation_messages') insertedMessages.push(row)
      return c
    })
    c.set = vi.fn(() => c)
    c.from = vi.fn(() => c)
    c.leftJoin = vi.fn(() => c)
    c.where = vi.fn(() => c)
    c.orderBy = vi.fn(() => c)
    c.limit = vi.fn(async () => (mocks.state.targetRow ? [mocks.state.targetRow] : []))
    c.returning = vi.fn(async () => {
      if (label === 'conversations') {
        const last = insertedConversations.at(-1) ?? {}
        return [
          {
            id: 'conversation_outbound',
            visitorPrincipalId: last.visitorPrincipalId ?? 'principal_target',
            assignedAgentPrincipalId: last.assignedAgentPrincipalId ?? null,
            status: last.status ?? 'open',
            subject: last.subject ?? null,
            lastMessagePreview: null,
            lastMessageAt: new Date(),
            visitorLastReadAt: null,
            agentLastReadAt: null,
            visitorEmail: null,
            createdAt: new Date(),
            updatedAt: null,
          },
        ]
      }
      if (label === 'conversation_messages') {
        const last = insertedMessages.at(-1) ?? {}
        return [{ ...last, id: 'conversation_msg_outbound', createdAt: new Date() }]
      }
      return []
    })
    return c
  }

  const tx = {
    select: vi.fn(() => chain('select')),
    insert: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
    update: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
  }

  return {
    db: {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      select: vi.fn(() => chain('select')),
      insert: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
      update: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    inArray: vi.fn(),
    conversations: { __name: 'conversations', id: 'id' },
    conversationMessages: { __name: 'conversation_messages', id: 'id' },
    principal: { __name: 'principal', id: 'id', type: 'type', role: 'role' },
    user: { __name: 'user', id: 'id', email: 'email' },
  }
})

import { startAgentConversation } from '../conversation.service'

const agentPrincipalId = 'principal_agent' as PrincipalId
const targetPrincipalId = 'principal_target' as PrincipalId
const agent = { principalId: agentPrincipalId, displayName: 'Jane Agent', email: null }
const agentActor: Actor = {
  principalId: agentPrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}
const visitorActor: Actor = {
  principalId: targetPrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

function portalUserTarget() {
  return { type: 'user', role: 'user', email: 'customer@example.com', contactEmail: null }
}

beforeEach(() => {
  insertedConversations.length = 0
  insertedMessages.length = 0
  vi.clearAllMocks()
  mocks.state.targetRow = portalUserTarget()
})

describe('startAgentConversation authorization', () => {
  it('rejects a non-agent actor before any write', async () => {
    await expect(
      startAgentConversation(
        { targetPrincipalId, content: 'Hi!' },
        { principalId: targetPrincipalId },
        visitorActor
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(insertedConversations).toHaveLength(0)
  })
})

describe('startAgentConversation target validation', () => {
  it('404s when the target principal does not exist', async () => {
    mocks.state.targetRow = null
    await expect(
      startAgentConversation({ targetPrincipalId, content: 'Hi!' }, agent, agentActor)
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(insertedConversations).toHaveLength(0)
  })

  it('rejects a team-member target', async () => {
    mocks.state.targetRow = { ...portalUserTarget(), role: 'member' }
    await expect(
      startAgentConversation({ targetPrincipalId, content: 'Hi!' }, agent, agentActor)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(insertedConversations).toHaveLength(0)
  })

  it('rejects a target with no deliverable email (anonymous, no contact)', async () => {
    mocks.state.targetRow = { type: 'anonymous', role: 'user', email: null, contactEmail: null }
    await expect(
      startAgentConversation({ targetPrincipalId, content: 'Hi!' }, agent, agentActor)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(insertedConversations).toHaveLength(0)
  })

  it('rejects an anonymous principal even when a contact email is on file', async () => {
    mocks.state.targetRow = {
      type: 'anonymous',
      role: 'user',
      email: null,
      contactEmail: 'captured@example.com',
    }
    await expect(
      startAgentConversation({ targetPrincipalId, content: 'Hi!' }, agent, agentActor)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(insertedConversations).toHaveLength(0)
  })

  it('rejects a target whose only address is the synthetic anonymous email', async () => {
    mocks.state.targetRow = {
      type: 'user',
      role: 'user',
      email: 'temp-abc123@anon.quackback.io',
      contactEmail: null,
    }
    await expect(
      startAgentConversation({ targetPrincipalId, content: 'Hi!' }, agent, agentActor)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(insertedConversations).toHaveLength(0)
  })

  it('rejects empty content before any write', async () => {
    await expect(
      startAgentConversation({ targetPrincipalId, content: '   ' }, agent, agentActor)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(insertedConversations).toHaveLength(0)
  })
})

describe('startAgentConversation happy path', () => {
  it('creates an open conversation owned by the target, assigned to the agent', async () => {
    const result = await startAgentConversation(
      { targetPrincipalId, content: 'Hello from support' },
      agent,
      agentActor
    )

    expect(result.created).toBe(true)
    expect(insertedConversations).toHaveLength(1)
    expect(insertedConversations[0]).toMatchObject({
      visitorPrincipalId: targetPrincipalId,
      assignedAgentPrincipalId: agentPrincipalId,
      status: 'open',
      subject: 'Hello from support',
    })
    // The first message is agent-typed and authored by the agent.
    expect(insertedMessages).toHaveLength(1)
    expect(insertedMessages[0]).toMatchObject({
      senderType: 'agent',
      principalId: agentPrincipalId,
      content: 'Hello from support',
    })
  })

  it('publishes the conversation + message and fires created/message webhooks', async () => {
    await startAgentConversation(
      { targetPrincipalId, content: 'Hello from support' },
      agent,
      agentActor
    )

    expect(publish.publishConversationUpdate).toHaveBeenCalledTimes(1)
    expect(publish.publishConversationEvent).toHaveBeenCalledWith(
      'conversation_outbound',
      expect.objectContaining({ kind: 'message' })
    )
    expect(emit.emitConversationCreated).toHaveBeenCalledTimes(1)
    expect(emit.emitMessageCreated).toHaveBeenCalledTimes(1)
  })

  it('always emails the first message via notifyConversationStarted', async () => {
    await startAgentConversation(
      { targetPrincipalId, content: 'Hello from support' },
      agent,
      agentActor
    )

    expect(notify.notifyConversationStarted).toHaveBeenCalledTimes(1)
    expect(notify.notifyConversationStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation_outbound',
        visitorPrincipalId: targetPrincipalId,
        agentName: 'Jane Agent',
      })
    )
    // Outbound conversations never notify the team of a "visitor message".
    expect(notify.notifyVisitorMessage).not.toHaveBeenCalled()
  })
})
