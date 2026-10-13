/**
 * Agent turns: one request for the workspace's own AI agent to answer a
 * customer message.
 *
 * The turn row is the lease. Requesting a turn supersedes any open one, an
 * answer is accepted only while the turn is still `requested`, and the
 * deadline job expires what nobody answered. The request is written in the same
 * transaction as the event that delivers it, so a turn is never half-created.
 */
import {
  db,
  conversations,
  supportAgents,
  conversationMessages,
  supportAgentTurns,
  and,
  eq,
  desc,
  sql,
  type SupportAgentTurnStatus,
} from '@/lib/server/db'
import type {
  ConversationId,
  ConversationMessageId,
  SupportAgentId,
  SupportAgentTurnId,
} from '@quackback/ids'
import { emit } from '@/lib/server/events/emit'
import { agentTurnExpired, agentTurnRequested } from '@/lib/server/events/catalogue'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import { recordDeliveryResult, type SupportAgent } from './support-agents.service'

const log = logger.child({ component: 'agent-turns' })

export const AGENT_TURN_DEADLINE_QUEUE = 'agent-turn-deadline'

/** A conversation that keeps asking is not a conversation an agent should answer forever. */
export const MAX_TURNS_PER_CONVERSATION = 50

export type SupportAgentTurn = typeof supportAgentTurns.$inferSelect

/**
 * Ask `agent` to answer the conversation. Supersedes any open turn, makes the
 * agent the conversation's controller, writes the delivery event and schedules
 * the deadline check, all in one transaction. Returns null when the
 * conversation has used its turn allowance.
 */
export async function requestAgentTurn(input: {
  conversationId: ConversationId
  agent: SupportAgent
  triggerMessageId: ConversationMessageId | null
}): Promise<SupportAgentTurn | null> {
  const { conversationId, agent, triggerMessageId } = input
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update')
    if (!conversation || conversation.channel !== 'messenger' || conversation.status !== 'open')
      return null
    const [live] = await tx.select().from(supportAgents).where(eq(supportAgents.id, agent.id))
    if (!live || live.deletedAt || live.status !== 'active') return null
    if (triggerMessageId) {
      const [existing] = await tx
        .select()
        .from(supportAgentTurns)
        .where(
          and(
            eq(supportAgentTurns.conversationId, conversationId),
            eq(supportAgentTurns.triggerMessageId, triggerMessageId)
          )
        )
      if (existing) return existing
      const [latest] = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversationId),
            eq(conversationMessages.senderType, 'visitor')
          )
        )
        .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
        .limit(1)
      if (latest?.id !== triggerMessageId) return null
    }
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(supportAgentTurns)
      .where(eq(supportAgentTurns.conversationId, conversationId))
    if (count >= MAX_TURNS_PER_CONVERSATION) {
      log.warn(
        { conversation_id: conversationId },
        'agent turn allowance used, leaving to the team'
      )
      return null
    }

    await tx
      .update(supportAgentTurns)
      .set({ status: 'superseded', completedAt: new Date() })
      .where(
        and(
          eq(supportAgentTurns.conversationId, conversationId),
          eq(supportAgentTurns.status, 'requested')
        )
      )

    const deadlineAt = new Date(Date.now() + agent.replyDeadlineSeconds * 1000)
    const [turn] = await tx
      .insert(supportAgentTurns)
      .values({ conversationId, agentId: agent.id, triggerMessageId, deadlineAt })
      .returning()

    await tx
      .update(conversations)
      .set({ controllerAgentId: agent.id })
      .where(eq(conversations.id, conversationId))

    await emit(tx, agentTurnRequested, {
      payload: {
        turnId: turn.id,
        agentId: agent.id,
        conversationId,
        triggerMessageId,
        deadlineAt: deadlineAt.toISOString(),
      },
      actor: { type: 'system' },
      entityId: conversationId,
    })

    await enqueueJob({
      queue: AGENT_TURN_DEADLINE_QUEUE,
      payload: { turnId: turn.id },
      dedupeKey: `${AGENT_TURN_DEADLINE_QUEUE}:${turn.id}`,
      runAt: deadlineAt,
      maxAttempts: 3,
      executor: tx,
    })
    return turn
  })
}

export async function getTurn(id: SupportAgentTurnId): Promise<SupportAgentTurn | null> {
  const [row] = await db.select().from(supportAgentTurns).where(eq(supportAgentTurns.id, id))
  return row ?? null
}

/** The turn still waiting for an answer on this conversation, newest first. */
export async function findOpenTurn(
  conversationId: ConversationId
): Promise<SupportAgentTurn | null> {
  const [row] = await db
    .select()
    .from(supportAgentTurns)
    .where(
      and(
        eq(supportAgentTurns.conversationId, conversationId),
        eq(supportAgentTurns.status, 'requested')
      )
    )
    .orderBy(desc(supportAgentTurns.createdAt))
    .limit(1)
  return row ?? null
}

/**
 * Settle an open turn. The conditional update is the arbiter between the
 * agent's answer, a teammate taking over and the deadline job: exactly one of
 * them moves the turn out of `requested`. Returns null when it lost.
 */
export async function settleTurn(
  id: SupportAgentTurnId,
  status: Exclude<SupportAgentTurnStatus, 'requested'>,
  extra: { replyKey?: string; agentId?: SupportAgentId } = {}
): Promise<SupportAgentTurn | null> {
  const [row] = await db
    .update(supportAgentTurns)
    .set({
      status,
      completedAt: new Date(),
      ...(extra.replyKey ? { replyKey: extra.replyKey } : {}),
    })
    .where(
      and(
        eq(supportAgentTurns.id, id),
        eq(supportAgentTurns.status, 'requested'),
        ...(extra.agentId ? [eq(supportAgentTurns.agentId, extra.agentId)] : [])
      )
    )
    .returning()
  return row ?? null
}

export async function recordTurnReply(
  id: SupportAgentTurnId,
  messageId: ConversationMessageId
): Promise<void> {
  await db
    .update(supportAgentTurns)
    .set({ replyMessageId: messageId })
    .where(eq(supportAgentTurns.id, id))
}

/**
 * A teammate took the conversation, or the workspace changed who answers: the
 * agent no longer controls it and any open turn is moot.
 */
export async function releaseAgentControl(conversationId: ConversationId): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update')
    await tx
      .update(supportAgentTurns)
      .set({ status: 'superseded', completedAt: new Date() })
      .where(
        and(
          eq(supportAgentTurns.conversationId, conversationId),
          eq(supportAgentTurns.status, 'requested')
        )
      )
    await tx
      .update(conversations)
      .set({ controllerAgentId: null })
      .where(eq(conversations.id, conversationId))
  })
}

/**
 * The deadline passed. If nobody answered the turn, hand the conversation to
 * the agent's fallback: the built-in AI when the plan includes it and it can
 * answer, otherwise the team. Safe to run more than once for the same turn.
 */
export async function expireTurn(
  id: SupportAgentTurnId,
  opts: { force?: boolean } = {}
): Promise<void> {
  const existing = await getTurn(id)
  if (!existing) return
  const expired = await db.transaction(async (tx) => {
    await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, existing.conversationId))
      .for('update')
    const [current] = await tx
      .select()
      .from(supportAgentTurns)
      .where(eq(supportAgentTurns.id, id))
      .for('update')
    if (!current || current.fallbackAppliedAt) return null
    if (current.status !== 'requested' && current.status !== 'expired') return null
    if (current.status === 'requested' && !opts.force && current.deadlineAt.getTime() > Date.now())
      return null
    const [agent] = await tx
      .select()
      .from(supportAgents)
      .where(eq(supportAgents.id, current.agentId))
    const fallback = agent?.fallback ?? 'team'
    if (current.status === 'requested') {
      await tx
        .update(supportAgentTurns)
        .set({ status: 'expired', completedAt: new Date() })
        .where(eq(supportAgentTurns.id, id))
      await emit(tx, agentTurnExpired, {
        payload: {
          turnId: current.id,
          agentId: current.agentId,
          conversationId: current.conversationId,
          fallback,
        },
        actor: { type: 'system' },
        entityId: current.conversationId,
      })
    }
    // Keep ownership until fallback takes it atomically. A retry must recover
    // an expired turn whose fallback did not finish, rather than drop it.
    return { turn: { ...current, status: 'expired' as const }, agent, fallback }
  })
  if (!expired) return

  const { turn, agent, fallback } = expired
  log.warn(
    { turn_id: turn.id, conversation_id: turn.conversationId, fallback },
    'agent turn expired'
  )
  if (agent)
    await recordDeliveryResult(agent.id, { ok: false, error: 'No reply before the deadline' })

  const { applyTurnFallback } = await import('./agent-actions.service')
  await applyTurnFallback(turn, agent ?? null, fallback)
}
