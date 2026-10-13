/**
 * The switchboard: when a customer writes on Messenger, who answers.
 *
 * Without the Labs switch every message goes to the built-in AI, exactly as it
 * always has. With it, the workspace's choice decides: the built-in AI, its own
 * AI agent (a turn request is raised for it), or nobody but the team. The
 * silence rules hold for every AI: once a teammate replies, or an AI hands the
 * conversation to the team, the AI stays quiet.
 */
import { db, conversations, eq } from '@/lib/server/db'
import type { ConversationId, ConversationMessageId, PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import {
  getExternalSupportAgent,
  getSupportAgent,
  type SupportAgent,
} from './support-agents.service'
import { releaseAgentControl, requestAgentTurn } from './turns.service'

const log = logger.child({ component: 'switchboard' })

export type AnswerRoute =
  { kind: 'quackback_ai' } | { kind: 'team' } | { kind: 'external'; agent: SupportAgent }

async function ownAgentEnabled(): Promise<boolean> {
  try {
    const { assertOwnAgentAvailable } = await import('./availability')
    await assertOwnAgentAvailable()
    return true
  } catch (err) {
    // A settings hiccup must not silence the built-in AI.
    log.warn({ err }, 'could not read the own-agent switch, using the built-in AI')
    return false
  }
}

/** Whether no human has taken the conversation and no AI has handed it off. */
async function aiMayAnswer(
  conversationId: ConversationId,
  agentPrincipalId: PrincipalId
): Promise<boolean> {
  const { getLatestInvolvement, loadConversationThread, mapRowsToThreadMessages, respondEligible } =
    await import('@/lib/server/domains/assistant')
  const latest = await getLatestInvolvement(conversationId)
  if (latest?.status === 'handed_off') return false
  const rows = await loadConversationThread(conversationId)
  const messages = mapRowsToThreadMessages(rows, agentPrincipalId)
  return respondEligible(messages)
}

export async function decideRoute(conversationId: ConversationId): Promise<AnswerRoute> {
  if (!(await ownAgentEnabled())) {
    await releaseIfControlled(conversationId)
    return { kind: 'quackback_ai' }
  }

  // A live conversation's owner takes precedence over the workspace default.
  const [conversation] = await db
    .select({ controllerAgentId: conversations.controllerAgentId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (conversation?.controllerAgentId) {
    const owner = await getSupportAgent(conversation.controllerAgentId)
    if (owner?.status === 'active' && owner.principalId) return { kind: 'external', agent: owner }
    await releaseAgentControl(conversationId)
    return owner?.fallback === 'quackback_ai' ? { kind: 'quackback_ai' } : { kind: 'team' }
  }

  const { getAnswering } = await import('@/lib/server/domains/settings/settings.answering')
  const { mode } = await getAnswering()

  if (mode === 'team') {
    await releaseIfControlled(conversationId)
    return { kind: 'team' }
  }
  if (mode === 'quackback_ai') {
    await releaseIfControlled(conversationId)
    return { kind: 'quackback_ai' }
  }

  const agent = await getExternalSupportAgent()
  if (!agent || agent.status !== 'active' || !agent.principalId) {
    return agent?.fallback === 'quackback_ai' ? { kind: 'quackback_ai' } : { kind: 'team' }
  }
  if (!(await aiMayAnswer(conversationId, agent.principalId))) return { kind: 'team' }
  return { kind: 'external', agent }
}

async function releaseIfControlled(conversationId: ConversationId): Promise<void> {
  const [row] = await db
    .select({ controllerAgentId: conversations.controllerAgentId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (row?.controllerAgentId) await releaseAgentControl(conversationId)
}

/** Route one customer message to whoever answers. Best-effort, never throws into the send. */
export async function answerCustomerMessage(
  conversationId: ConversationId,
  messageId: ConversationMessageId
): Promise<void> {
  const route = await decideRoute(conversationId)
  if (route.kind === 'team') return
  if (route.kind === 'quackback_ai') {
    const { runAssistantTurnForConversation } =
      await import('@/lib/server/domains/assistant/assistant.orchestrator')
    await runAssistantTurnForConversation(conversationId)
    return
  }
  const turn = await requestAgentTurn({
    conversationId,
    agent: route.agent,
    triggerMessageId: messageId,
  })
  if (!turn) {
    log.info({ conversation_id: conversationId }, 'agent turn not requested, left to the team')
  }
}
