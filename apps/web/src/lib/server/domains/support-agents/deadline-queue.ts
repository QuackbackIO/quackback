/**
 * `agent-turn-deadline` job handler: the moment an AI agent's reply deadline
 * passes, expire the turn if nobody answered it and hand the conversation to
 * the agent's fallback. One job per turn, queued with the turn at its deadline.
 * Running it for a turn that was already answered is a no-op.
 */
import type { SupportAgentTurnId } from '@quackback/ids'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { expireTurn, getTurn } from './turns.service'
import { db, supportAgentTurns, conversations, eq, desc } from '@/lib/server/db'
import { runAssistantTurnForConversation } from '@/lib/server/domains/assistant/assistant.orchestrator'

export async function runTurnDeadline(job: ClaimedJob): Promise<void> {
  const turnId = (job.payload as { turnId?: string }).turnId
  if (!turnId) return
  if ((job.payload as { builtin?: boolean }).builtin) {
    const turn = await getTurn(turnId as SupportAgentTurnId)
    if (!turn || turn.status !== 'expired' || !turn.fallbackAppliedAt) return
    const [latest] = await db
      .select({ id: supportAgentTurns.id })
      .from(supportAgentTurns)
      .where(eq(supportAgentTurns.conversationId, turn.conversationId))
      .orderBy(desc(supportAgentTurns.createdAt), desc(supportAgentTurns.id))
      .limit(1)
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, turn.conversationId))
    if (
      latest?.id !== turn.id ||
      !conversation ||
      conversation.controllerAgentId ||
      conversation.status !== 'open'
    )
      return
    await runAssistantTurnForConversation(turn.conversationId)
    return
  }
  await expireTurn(turnId as SupportAgentTurnId)
}
