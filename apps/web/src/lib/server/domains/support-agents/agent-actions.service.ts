/**
 * What the workspace's own AI agent can do to a conversation it controls:
 * show that it is working, stream its text, reply, hand off to the team and
 * resolve. Every write is checked against the conversation's current
 * controller first, so an agent that lost the conversation (a teammate took
 * it, the deadline passed) cannot write to it.
 *
 * Replies are ordinary assistant-style messages from the agent's own service
 * principal, so they read as AI everywhere, and they land on the same
 * involvement records the built-in AI writes, so analytics count them alike.
 */
import {
  db,
  conversations,
  conversationMessages,
  supportAgentTurns,
  supportAgents,
  eq,
  type Conversation,
} from '@/lib/server/db'
import type { ConversationId, ConversationMessageId, SupportAgentTurnId } from '@quackback/ids'
import type {
  ConversationMessageCitation,
  ConversationStreamEvent,
} from '@/lib/shared/conversation/types'
import type { ConversationAuthorInput } from '@/lib/server/domains/conversation/conversation.types'
import type { TiptapContent } from '@/lib/server/db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { publishConversationOnlyEvent } from '@/lib/server/realtime/conversation-channels'
import {
  clearActivitySnapshot,
  writeActivitySnapshot,
} from '@/lib/server/domains/assistant/assistant-activity-snapshot'
import { logger } from '@/lib/server/logger'
import type { AgentActivityStatus } from '@/lib/shared/support-agents'
import type { SupportAgent } from './support-agents.service'
import { getTurn } from './turns.service'
import { engage } from './agent-involvement'

const log = logger.child({ component: 'agent-actions' })

type TurnRow = NonNullable<Awaited<ReturnType<typeof getTurn>>>

function authorOf(agent: SupportAgent): ConversationAuthorInput {
  if (!agent.principalId) throw new Error('support agent has no principal')
  return { principalId: agent.principalId, displayName: agent.name, avatarUrl: null }
}

async function loadConversation(conversationId: ConversationId): Promise<Conversation> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!row) throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
  return row
}

/** Who controls the conversation right now, for the 409 an agent receives. */
async function currentControllerOf(
  conversation: Conversation
): Promise<'ai_agent' | 'quackback_ai' | 'team'> {
  if (conversation.controllerAgentId) return 'ai_agent'
  const { getLatestInvolvement } = await import('@/lib/server/domains/assistant')
  const latest = await getLatestInvolvement(conversation.id)
  return latest?.status === 'active' && latest.supportAgentId === null ? 'quackback_ai' : 'team'
}

/** The conversation, once the agent is confirmed as its controller. */
export async function assertAgentControls(
  agent: SupportAgent,
  conversationId: ConversationId
): Promise<Conversation> {
  const conversation = await loadConversation(conversationId)
  if (conversation.status === 'closed')
    throw new ConflictError('CONVERSATION_CLOSED', 'This conversation is closed')
  if (conversation.status !== 'open')
    throw new ConflictError('CONVERSATION_PAUSED', 'This conversation is paused')
  if (conversation.controllerAgentId !== agent.id) {
    const controller = await currentControllerOf(conversation)
    throw new ConflictError(
      'NOT_CONTROLLER',
      `This conversation is not controlled by this agent. Current controller: ${controller}`
    )
  }
  const [live] = await db.select().from(supportAgents).where(eq(supportAgents.id, agent.id))
  if (
    !live ||
    live.deletedAt ||
    live.status !== 'active' ||
    live.credentialHash !== agent.credentialHash
  )
    throw new ConflictError('AGENT_UNAVAILABLE', 'The agent is no longer available')
  return conversation
}

async function claimTurn(
  agent: SupportAgent,
  conversationId: ConversationId,
  turnId: SupportAgentTurnId
): Promise<TurnRow> {
  const turn = await getTurn(turnId)
  if (!turn || turn.conversationId !== conversationId || turn.agentId !== agent.id) {
    throw new NotFoundError('TURN_NOT_FOUND', 'Turn not found')
  }
  return turn
}

export interface AgentReplyInput {
  agent: SupportAgent
  conversationId: ConversationId
  turnId: SupportAgentTurnId
  content: string
  contentJson?: TiptapContent | null
  citations?: ConversationMessageCitation[]
  idempotencyKey: string
}

export interface AgentReplyResult {
  messageId: ConversationMessageId
  createdAt: string
  replayed: boolean
}

/** Post the agent's answer to an open turn. A retry with the same key returns the same message. */
export async function postAgentReply(input: AgentReplyInput): Promise<AgentReplyResult> {
  const { agent, conversationId, turnId, idempotencyKey } = input
  const content = input.content.trim()
  if (!content) throw new ValidationError('VALIDATION_ERROR', 'Reply content is required')

  const { persistAssistantReply, publishAssistantReply } =
    await import('../conversation/assistant-reply')
  const result = await db.transaction(async (tx) => {
    // Every turn operation locks the conversation before the turn.
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update')
    if (!conversation) throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
    const [turn] = await tx
      .select()
      .from(supportAgentTurns)
      .where(eq(supportAgentTurns.id, turnId))
      .for('update')
    if (!turn || turn.conversationId !== conversationId || turn.agentId !== agent.id)
      throw new NotFoundError('TURN_NOT_FOUND', 'Turn not found')
    if (turn.status === 'replied' && turn.replyKey === idempotencyKey && turn.replyMessageId) {
      const [message] = await tx
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, turn.replyMessageId))
      if (message) {
        const citationsOf = (citations: ConversationMessageCitation[] | null | undefined) =>
          JSON.stringify((citations ?? []).map((c) => [c.type, c.id, c.title, c.url]))
        if (
          message.content !== content ||
          citationsOf(message.citations) !== citationsOf(input.citations)
        )
          throw new ConflictError('IDEMPOTENCY_KEY_REUSED', 'This key already names another reply')
        return { replayed: true as const, message }
      }
    }
    if (conversation.status === 'closed')
      throw new ConflictError('CONVERSATION_CLOSED', 'This conversation is closed')
    if (conversation.status !== 'open')
      throw new ConflictError('CONVERSATION_PAUSED', 'This conversation is paused')
    if (conversation.controllerAgentId !== agent.id)
      throw new ConflictError('NOT_CONTROLLER', 'The conversation has another controller')
    const [live] = await tx.select().from(supportAgents).where(eq(supportAgents.id, agent.id))
    if (
      !live ||
      live.deletedAt ||
      live.status !== 'active' ||
      live.credentialHash !== agent.credentialHash
    )
      throw new ConflictError('AGENT_UNAVAILABLE', 'The agent is no longer available')
    if (turn.status !== 'requested' || turn.deadlineAt.getTime() <= Date.now())
      throw new ConflictError('STALE_TURN', 'This turn is no longer open')
    const involvement = await engage(agent, conversationId, tx)
    const citations = (input.citations ?? []).map((c): ConversationMessageCitation => ({
      type: c.type,
      id: c.id,
      title: c.title,
      url: c.url,
    }))
    const stored = await persistAssistantReply(tx, conversationId, content, authorOf(agent), {
      waiting: false,
      emitCreated: true,
      citations,
      contentJson: input.contentJson ?? null,
      controllerAgentId: agent.id,
    })
    await tx
      .update(supportAgentTurns)
      .set({
        status: 'replied',
        completedAt: new Date(),
        replyKey: idempotencyKey,
        replyMessageId: stored.message.id,
      })
      .where(eq(supportAgentTurns.id, turnId))
    const { recordAssistantAnswer } = await import('@/lib/server/domains/assistant')
    await recordAssistantAnswer(involvement.id, { sources: citations }, tx)
    return { replayed: false as const, message: stored.message, stored }
  })
  if (!result.replayed) {
    await publishAssistantReply(result.stored, authorOf(agent))
    await clearActivitySnapshot(conversationId).catch((err) =>
      log.warn({ err, conversation_id: conversationId }, 'could not clear agent activity')
    )
  }
  return {
    messageId: result.message.id,
    createdAt: result.message.createdAt.toISOString(),
    replayed: result.replayed,
  }
}

/** Show the customer that the agent is working. Ephemeral, never stored. */
export async function setAgentActivity(
  agent: SupportAgent,
  conversationId: ConversationId,
  status: AgentActivityStatus
): Promise<void> {
  await assertAgentControls(agent, conversationId)
  const event: ConversationStreamEvent = {
    kind: 'assistant_activity',
    conversationId,
    status,
    at: new Date().toISOString(),
  }
  publishConversationOnlyEvent(conversationId, event)
  void writeActivitySnapshot(conversationId, event)
}

const STREAM_PUBLISH_INTERVAL_MS = 90

/**
 * Show the customer the agent's text as it is written. Each publish carries the
 * whole answer so far, like the built-in AI, so a dropped frame heals on the
 * next one. The persisted reply replaces it.
 */
export async function streamAgentText(
  agent: SupportAgent,
  conversationId: ConversationId,
  turnId: SupportAgentTurnId,
  chunks: AsyncIterable<string>,
  maxChars: number
): Promise<{ chars: number }> {
  await assertAgentControls(agent, conversationId)
  const turn = await claimTurn(agent, conversationId, turnId)
  if (turn.status !== 'requested') {
    throw new ConflictError('STALE_TURN', `This turn is no longer open (it is ${turn.status})`)
  }
  let text = ''
  let lastPublishAt = 0
  const publish = async (at: number) => {
    await assertAgentControls(agent, conversationId)
    const current = await claimTurn(agent, conversationId, turnId)
    if (current.status !== 'requested' || current.deadlineAt.getTime() <= Date.now()) {
      throw new ConflictError('STALE_TURN', 'This turn is no longer open')
    }
    lastPublishAt = at
    publishConversationOnlyEvent(conversationId, {
      kind: 'assistant_delta',
      conversationId,
      text,
      at: new Date(at).toISOString(),
    })
  }
  for await (const chunk of chunks) {
    if (text.length + chunk.length > maxChars) {
      throw new ValidationError('VALIDATION_ERROR', 'The streamed text is too long')
    }
    text += chunk
    const now = Date.now()
    if (now - lastPublishAt >= STREAM_PUBLISH_INTERVAL_MS) await publish(now)
  }
  if (text) await publish(Date.now())
  return { chars: text.length }
}

export {
  handOffToTeam,
  resolveAsAgent,
  finishHandoff,
  applyTurnFallback,
} from './agent-outcomes.service'
