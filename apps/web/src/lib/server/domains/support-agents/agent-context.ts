/**
 * What an AI agent is told about a conversation: the same shape in a turn
 * request and in the context read, so an agent parses one document.
 *
 * Customer-written text is content, not instructions. Like the MCP tool
 * results, the document carries an `untrusted` descriptor listing the JSON
 * paths of text written outside the team, and no value is rewritten.
 */
import type { ConversationId, SupportAgentTurnId } from '@quackback/ids'
import type { ConversationDTO, ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { realEmail } from '@/lib/shared/anonymous-email'
import { UNTRUSTED_NOTE } from '@/lib/server/mcp/untrusted'
import { ConflictError, NotFoundError } from '@/lib/shared/errors'
import type { SupportAgent } from './support-agents.service'

/** How many recent messages an agent is given. */
export const AGENT_CONTEXT_MESSAGE_LIMIT = 40

export type AgentMessageRole = 'customer' | 'teammate' | 'ai' | 'system'

export interface AgentContextMessage {
  id: string
  role: AgentMessageRole
  content: string
  authorName: string | null
  createdAt: string
}

export interface AgentConversationContext {
  conversation: {
    id: string
    status: string
    channel: string
    subject: string | null
    createdAt: string
  }
  customer: {
    principalId: string
    name: string | null
    email: string | null
  }
  messages: AgentContextMessage[]
  untrusted: { note: string; fields: string[] }
}

function roleOf(message: ConversationMessageDTO): AgentMessageRole {
  if (message.senderType === 'visitor') return 'customer'
  if (message.senderType === 'system') return 'system'
  return message.isAssistant ? 'ai' : 'teammate'
}

/** Pure: shape a conversation and its public thread into the agent document. */
export function buildAgentContext(
  conversation: ConversationDTO,
  thread: readonly ConversationMessageDTO[]
): AgentConversationContext {
  const messages = thread
    .filter((m) => !m.isInternal)
    .map((m): AgentContextMessage => ({
      id: m.id,
      role: roleOf(m),
      content: m.content,
      authorName: m.author?.displayName ?? null,
      createdAt: m.createdAt,
    }))

  // Customer messages and system notices (which quote customer details) are
  // outside text. Teammate and AI messages are the team's own.
  const fields: string[] = []
  if (conversation.subject) fields.push('conversation.subject')
  fields.push('customer.name', 'customer.email')
  messages.forEach((m, i) => {
    if (m.role === 'customer' || m.role === 'system') {
      fields.push(`messages[${i}].content`)
      if (m.authorName) fields.push(`messages[${i}].authorName`)
    }
  })

  return {
    conversation: {
      id: conversation.id,
      status: conversation.status,
      channel: conversation.channel,
      subject: conversation.subject,
      createdAt: conversation.createdAt,
    },
    customer: {
      principalId: conversation.visitor.principalId,
      name: conversation.visitor.displayName,
      email: realEmail(conversation.visitorEmail),
    },
    messages,
    untrusted: { note: UNTRUSTED_NOTE, fields },
  }
}

/** Load a conversation and its recent public thread as the agent document. */
export async function loadAgentContext(
  conversationId: ConversationId
): Promise<AgentConversationContext> {
  const { conversationToDTO, listMessages } =
    await import('@/lib/server/domains/conversation/conversation.query')
  const { db, conversations, eq } = await import('@/lib/server/db')
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!row) throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
  const [dto, page] = await Promise.all([
    conversationToDTO(row, 'agent'),
    listMessages(conversationId, {
      includeInternal: false,
      limit: AGENT_CONTEXT_MESSAGE_LIMIT,
    }),
  ])
  return buildAgentContext(dto, page.messages)
}

/** Recheck the lease after reading the thread, before releasing customer data. */
export async function loadControlledAgentContext(
  agent: SupportAgent,
  conversationId: ConversationId
): Promise<AgentConversationContext> {
  const { assertAgentControls } = await import('./agent-actions.service')
  await assertAgentControls(agent, conversationId)
  const context = await loadAgentContext(conversationId)
  await assertAgentControls(agent, conversationId)
  return context
}

/** Polling and push delivery share the same live-turn fence. */
export async function loadRequestedAgentTurnContext(
  agent: SupportAgent,
  turn: { id: SupportAgentTurnId; conversationId: ConversationId }
): Promise<AgentConversationContext> {
  const context = await loadControlledAgentContext(agent, turn.conversationId)
  const { getTurn } = await import('./turns.service')
  const live = await getTurn(turn.id)
  if (
    !live ||
    live.agentId !== agent.id ||
    live.conversationId !== turn.conversationId ||
    live.status !== 'requested' ||
    live.deadlineAt <= new Date()
  )
    throw new ConflictError('TURN_NOT_OPEN', 'This turn is no longer open')
  return context
}
