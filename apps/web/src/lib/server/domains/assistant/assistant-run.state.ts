/**
 * Reads over a conversation's Quinn state that are not fences.
 *
 * Split out of `assistant-run.repository.ts` alongside the ledger: the
 * repository owns the run row's transitions and the three facts that fence a
 * publication, and this module answers the two questions other domains ask
 * about a conversation, plus the one release a parked run needs.
 */
import { db, and, desc, eq, isNotNull, sql, conversations, assistantRuns } from '@/lib/server/db'
import type { AssistantRunPhase, AssistantRunStatus } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { AssistantRunId, ConversationId } from '@quackback/ids'
import type { AssistantRunRow } from './assistant-run.repository'

/** What a reconnecting client may know about an in-flight run. */
export interface DurableRunState {
  runId: AssistantRunId
  status: AssistantRunStatus
  phase: AssistantRunPhase
  startedAt: Date | null
}

/**
 * The newest still-open run for a conversation.
 *
 * Read by the visitor stream on reconnect: the ephemeral activity trace only
 * exists while some process is publishing it, so a customer who reconnects
 * after a worker died would otherwise see nothing at all. Returns only
 * lifecycle facts. No trace text, no evidence, no model detail.
 *
 * `waiting_action` is deliberately NOT here. A parked run is waiting on a
 * person, not generating, and the customer has already been told so in the
 * thread; reporting it as in flight would leave a typing indicator running for
 * as long as the approval took.
 */
export async function getOpenRunState(
  conversationId: ConversationId,
  exec: Executor = db
): Promise<DurableRunState | null> {
  const [row] = await exec
    .select({
      runId: assistantRuns.id,
      status: assistantRuns.status,
      phase: assistantRuns.phase,
      startedAt: assistantRuns.startedAt,
    })
    .from(assistantRuns)
    .where(
      and(
        eq(assistantRuns.conversationId, conversationId),
        sql`${assistantRuns.status} IN ('queued', 'running')`,
        isNotNull(assistantRuns.startedAt)
      )
    )
    .orderBy(desc(assistantRuns.createdAt))
    .limit(1)
  return row ?? null
}

/**
 * Release a run parked on an action whose result is never coming (P4).
 *
 * A proposal that expired undecided, or was otherwise settled without ever
 * producing an outcome, leaves `waiting_action` behind. That status means
 * "Quinn owes a result", and the inactivity clock stands down while it is
 * true, so something has to end it or the conversation is held open forever.
 * Guarded on the status, so a result that arrives in the same moment wins.
 */
export async function releaseParkedRun(
  exec: Executor,
  runId: AssistantRunId,
  disposition: string
): Promise<AssistantRunRow | null> {
  const [row] = await exec
    .update(assistantRuns)
    .set({
      status: 'cancelled',
      phase: 'publication',
      disposition,
      finishedAt: new Date(),
      updatedAt: new Date(),
      stateVersion: sql`${assistantRuns.stateVersion} + 1`,
    })
    .where(and(eq(assistantRuns.id, runId), eq(assistantRuns.status, 'waiting_action')))
    .returning()
  return row ?? null
}

/**
 * What a delegating workflow needs to know about Quinn's side of the
 * conversation before deciding that a wait has run out of time (P4).
 *
 * Four facts, each one a different reason not to treat a deadline as "the
 * execution died": a turn is still generating, a turn is parked on a decision
 * somebody owes an answer to, Quinn answered and the customer simply has not
 * come back, or a human took the conversation over and the wait is moot.
 */
export interface AssistantEngagementState {
  /** A run is queued or generating right now. */
  executing: boolean
  /** A run published an acknowledgement and owes the result of an approved action. */
  awaitingAction: boolean
  /** Quinn delivered a substantive answer and the involvement is still open. */
  answered: boolean
  /** A teammate owns the customer: assigned, or an involvement handed off. */
  takenOver: boolean
  /** The conversation is still open. A closed or snoozed one is nobody's to answer. */
  open: boolean
}

export async function readAssistantEngagementState(
  conversationId: ConversationId,
  exec: Executor = db
): Promise<AssistantEngagementState> {
  const [runs] = await exec
    .select({
      executing: sql<number>`count(*) FILTER (WHERE ${assistantRuns.status} IN ('queued', 'running'))`,
      awaitingAction: sql<number>`count(*) FILTER (WHERE ${assistantRuns.status} = 'waiting_action')`,
    })
    .from(assistantRuns)
    .where(eq(assistantRuns.conversationId, conversationId))
  const [conversation] = await exec
    .select({
      status: conversations.status,
      assignedAgentPrincipalId: conversations.assignedAgentPrincipalId,
      inactivityOwner: conversations.inactivityOwner,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  const { getLatestInvolvement } = await import('./assistant.involvement')
  const latest = await getLatestInvolvement(conversationId, exec)
  return {
    executing: Number(runs?.executing ?? 0) > 0,
    awaitingAction: Number(runs?.awaitingAction ?? 0) > 0,
    // The involvement's own answer stamp, not the run's outcome: a follow-up
    // nudge and a clarification deliberately leave it where it was.
    answered: latest?.status === 'active' && latest.lastAssistantAnswerAt !== null,
    takenOver:
      !!conversation?.assignedAgentPrincipalId ||
      latest?.status === 'handed_off' ||
      conversation?.inactivityOwner === 'handoff',
    open: conversation?.status === 'open',
  }
}
