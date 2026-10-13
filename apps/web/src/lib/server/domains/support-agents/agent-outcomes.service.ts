import {
  db,
  conversations,
  conversationMessages,
  assistantInvolvements,
  supportAgentTurns,
  supportAgents,
  type Transaction,
  and,
  eq,
  inArray,
  desc,
  type AssistantHandoffReason,
} from '@/lib/server/db'
import type { ConversationId, SupportAgentTurnId } from '@quackback/ids'
import type { SupportAgent } from './support-agents.service'
import type { getTurn } from './turns.service'
import { engage } from './agent-involvement'
import { ConflictError, NotFoundError } from '@/lib/shared/errors'
import {
  publishAgentConversationEvent,
  publishConversationUpdate,
  publishConversationEvent,
} from '@/lib/server/realtime/conversation-channels'
import { clearActivitySnapshot } from '@/lib/server/domains/assistant/assistant-activity-snapshot'
import { toMessageDTO } from '@/lib/server/messages/message-core'
import { conversationToDTO } from '../conversation/conversation.query'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { emit } from '@/lib/server/events/emit'
import { assistantHandedOff, assistantResolved } from '@/lib/server/events/catalogue'
import { logger } from '@/lib/server/logger'
const log = logger.child({ component: 'agent-outcomes' })
type TurnRow = NonNullable<Awaited<ReturnType<typeof getTurn>>>

async function lockController(
  tx: Transaction,
  agent: SupportAgent,
  conversationId: ConversationId
) {
  const [conversation] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .for('update')
  if (!conversation) throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
  if (conversation.status !== 'open')
    throw new ConflictError('CONVERSATION_PAUSED', 'This conversation is closed or paused')
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
  return conversation
}

async function assertCurrentTurn(
  tx: Transaction,
  agent: SupportAgent,
  conversationId: ConversationId,
  id: SupportAgentTurnId
) {
  const [latest] = await tx
    .select()
    .from(supportAgentTurns)
    .where(eq(supportAgentTurns.conversationId, conversationId))
    .orderBy(desc(supportAgentTurns.createdAt), desc(supportAgentTurns.id))
    .limit(1)
  if (
    !latest ||
    latest.id !== id ||
    latest.agentId !== agent.id ||
    !['requested', 'replied'].includes(latest.status) ||
    (latest.status === 'requested' && latest.deadlineAt.getTime() <= Date.now())
  )
    throw new ConflictError('STALE_TURN', 'This turn is no longer current')
}

async function closeTurns(
  tx: Transaction,
  conversationId: ConversationId,
  status: 'handed_off' | 'resolved'
) {
  await tx
    .update(supportAgentTurns)
    .set({ status, completedAt: new Date() })
    .where(
      and(
        eq(supportAgentTurns.conversationId, conversationId),
        inArray(supportAgentTurns.status, ['requested', 'replied'])
      )
    )
}

export async function finishHandoff(
  tx: Transaction,
  agent: SupportAgent | null,
  conversationId: ConversationId,
  reason: AssistantHandoffReason,
  note?: string | null
) {
  if (agent?.principalId) {
    const involvement = await engage(agent, conversationId, tx)
    const { recordHandoff } = await import('@/lib/server/domains/assistant')
    if (!(await recordHandoff(involvement.id, reason, tx)))
      throw new ConflictError('ALREADY_ENDED', 'This engagement already ended')
  }
  await closeTurns(tx, conversationId, 'handed_off')
  const [conversation] = await tx
    .update(conversations)
    .set({
      controllerAgentId: null,
      status: 'open',
      waitingSince: new Date(),
      resolvedAt: null,
      snoozedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId))
    .returning()
  const messages = await tx
    .insert(conversationMessages)
    .values([
      {
        conversationId,
        principalId: null,
        senderType: 'system' as const,
        content: 'Connecting you to the team',
        metadata: { systemEvent: { kind: 'assistant_handoff' as const } },
      },
      {
        conversationId,
        principalId: agent?.principalId ?? null,
        senderType: 'agent' as const,
        isInternal: true,
        content: `AI agent handed off (${reason.replace(/_/g, ' ')}).${note?.trim() ? ` ${note.trim()}` : ''}`,
      },
    ])
    .returning()
  await emit(tx, assistantHandedOff, {
    payload: { conversationId, reason },
    actor: { type: 'system', ...(agent?.principalId ? { id: agent.principalId } : {}) },
    entityId: conversationId,
  })
  return { conversation, messages }
}

async function publishHandoff(result: Awaited<ReturnType<typeof finishHandoff>>) {
  const id = result.conversation.id
  await clearActivitySnapshot(id).catch((err) =>
    log.warn({ err }, 'could not clear agent activity')
  )
  await publishConversationUpdate(id, await conversationToDTO(result.conversation, 'agent'))
  for (const message of result.messages) {
    const event = {
      kind: 'message' as const,
      conversationId: id,
      message: toMessageDTO(message, null),
    }
    if (message.isInternal) publishAgentConversationEvent(event)
    else publishConversationEvent(id, event)
  }
  const { hasLiveWorkflowForTrigger } =
    await import('@/lib/server/domains/workflows/workflow.service')
  if (!(await hasLiveWorkflowForTrigger('assistant.handed_off'))) {
    const { routeUnassignedConversation } = await import('../conversation/conversation.service')
    await routeUnassignedConversation(result.conversation)
  }
}

/** Ownership, outcome, notices and event commit together before broadcasting. */
export async function handOffToTeam(input: {
  turnId: SupportAgentTurnId
  agent: SupportAgent
  conversationId: ConversationId
  reason: AssistantHandoffReason
  note?: string | null
}): Promise<void> {
  const result = await db.transaction(async (tx) => {
    await lockController(tx, input.agent, input.conversationId)
    await assertCurrentTurn(tx, input.agent, input.conversationId, input.turnId)
    return finishHandoff(tx, input.agent, input.conversationId, input.reason, input.note)
  })
  await publishHandoff(result).catch((err) =>
    log.warn(
      { err, conversation_id: input.conversationId },
      'stored handoff could not be broadcast'
    )
  )
}

export async function resolveAsAgent(input: {
  turnId: SupportAgentTurnId
  agent: SupportAgent
  conversationId: ConversationId
  confirmed: boolean
  summary?: string | null
}): Promise<{ outcome: 'resolved_confirmed' | 'resolved_assumed' }> {
  const outcome = input.confirmed ? ('resolved_confirmed' as const) : ('resolved_assumed' as const)
  const result = await db.transaction(async (tx) => {
    await lockController(tx, input.agent, input.conversationId)
    await assertCurrentTurn(tx, input.agent, input.conversationId, input.turnId)
    const [active] = await tx
      .update(assistantInvolvements)
      .set({ status: outcome, endedAt: new Date() })
      .where(
        and(
          eq(assistantInvolvements.conversationId, input.conversationId),
          eq(assistantInvolvements.supportAgentId, input.agent.id),
          eq(assistantInvolvements.status, 'active')
        )
      )
      .returning()
    if (!active)
      throw new ConflictError('NOT_ENGAGED', 'This agent has not answered this conversation yet')
    await closeTurns(tx, input.conversationId, 'resolved')
    const [conversation] = await tx
      .update(conversations)
      .set({ controllerAgentId: null })
      .where(eq(conversations.id, input.conversationId))
      .returning()
    await emit(tx, assistantResolved, {
      payload: { conversationId: input.conversationId, outcome },
      actor: { type: 'system', id: input.agent.principalId! },
      entityId: input.conversationId,
    })
    const [message] = input.summary?.trim()
      ? await tx
          .insert(conversationMessages)
          .values({
            conversationId: input.conversationId,
            principalId: input.agent.principalId,
            senderType: 'agent',
            isInternal: true,
            content: `AI agent resolved: ${input.summary.trim()}`,
          })
          .returning()
      : []
    return { conversation, message }
  })
  await clearActivitySnapshot(input.conversationId).catch(() => {})
  if (result.message)
    publishAgentConversationEvent({
      kind: 'message',
      conversationId: input.conversationId,
      message: toMessageDTO(result.message, null),
    })
  return { outcome }
}

/** Recovery repeats only an unfinished fallback for the latest turn, never a newer owner. */
export async function applyTurnFallback(
  turn: TurnRow,
  agent: SupportAgent | null,
  fallback: 'quackback_ai' | 'team'
): Promise<void> {
  const orchestrator =
    fallback === 'quackback_ai'
      ? await import('@/lib/server/domains/assistant/assistant.orchestrator')
      : null
  const builtin =
    orchestrator &&
    (await orchestrator.previewAssistantTurnForConversation(turn.conversationId)) === 'eligible'
  const result = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, turn.conversationId))
      .for('update')
    const [current] = await tx
      .select()
      .from(supportAgentTurns)
      .where(eq(supportAgentTurns.id, turn.id))
      .for('update')
    if (!conversation || !current || current.status !== 'expired' || current.fallbackAppliedAt)
      return null
    const [latest] = await tx
      .select({ id: supportAgentTurns.id })
      .from(supportAgentTurns)
      .where(eq(supportAgentTurns.conversationId, turn.conversationId))
      .orderBy(desc(supportAgentTurns.createdAt), desc(supportAgentTurns.id))
      .limit(1)
    if (
      latest?.id !== turn.id ||
      conversation.status !== 'open' ||
      conversation.controllerAgentId !== turn.agentId
    ) {
      await tx
        .update(supportAgentTurns)
        .set({ fallbackAppliedAt: new Date() })
        .where(eq(supportAgentTurns.id, turn.id))
      return null
    }
    if (builtin) {
      await tx
        .update(assistantInvolvements)
        .set({ status: 'abandoned', endedAt: new Date() })
        .where(
          and(
            eq(assistantInvolvements.conversationId, turn.conversationId),
            eq(assistantInvolvements.status, 'active'),
            eq(assistantInvolvements.supportAgentId, turn.agentId)
          )
        )
      await tx
        .update(conversations)
        .set({ controllerAgentId: null })
        .where(eq(conversations.id, turn.conversationId))
      // Queue the built-in attempt in this transaction so a crash after commit
      // cannot lose it. The same deadline job handles the durable second step.
      await enqueueJob({
        queue: 'agent-turn-deadline',
        payload: { turnId: turn.id, builtin: true },
        dedupeKey: `agent-native-fallback:${turn.id}`,
        maxAttempts: 3,
        executor: tx,
      })
      await tx
        .update(supportAgentTurns)
        .set({ fallbackAppliedAt: new Date() })
        .where(eq(supportAgentTurns.id, turn.id))
      return null
    }
    const handoff = await finishHandoff(tx, agent, turn.conversationId, 'system_error')
    await tx
      .update(supportAgentTurns)
      .set({ fallbackAppliedAt: new Date() })
      .where(eq(supportAgentTurns.id, turn.id))
    return handoff
  })
  if (result)
    await publishHandoff(result).catch((err) =>
      log.warn({ err, turn_id: turn.id }, 'stored fallback could not be broadcast')
    )
}
