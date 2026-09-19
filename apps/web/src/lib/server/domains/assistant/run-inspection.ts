/**
 * The run inspector's reads (QUINN-PRODUCT Step 11, P8).
 *
 * One question: what did Quinn do on this item, and why did it end that way?
 * Everything here is derived from rows Steps 3 to 10 already write, so there is
 * nothing new to keep current and nothing that can drift from what actually
 * happened:
 *
 *  - the run row is the trigger, the state, the timings and the disposition;
 *  - `assistant_run_steps` is the generation and both validator layers, and
 *    carries the guidance a turn applied and what the budget left out;
 *  - `assistant_run_evidence` is the passages the answer was allowed to use;
 *  - `assistant_tool_calls` is what was actually done, with its receipt;
 *  - `assistant_pending_actions` is the approval and its execution, kept as the
 *    two separate readings Step 5 established;
 *  - the effective snapshot and the release it belongs to are the behaviour it
 *    ran under.
 *
 * This module does NO authorization of its own. Every caller is a server
 * function that has already established the caller may view the run's parent,
 * which is the same check the conversation or ticket itself applies; a read
 * here for an item the caller cannot see would otherwise be a way around it.
 *
 * Nothing here is visitor-facing. The DTOs are for the inbox AI section and the
 * Improve page, both teammate-only surfaces; the visitor contract is unchanged
 * and is pinned by its own test.
 */
import { and, db, desc, eq, inArray } from '@/lib/server/db'
import {
  assistantEffectiveSnapshots,
  assistantPendingActions,
  assistantReleases,
  assistantRunEvidence,
  assistantRunSteps,
  assistantRuns,
  assistantToolCalls,
} from '@/lib/server/db'
import type { AssistantRunId, ConversationId, TicketId } from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { JsonValue } from '@/lib/shared/json'

/** A run as the list beside a conversation shows it. */
export interface AssistantRunSummary {
  id: string
  conversationId: string | null
  ticketId: string | null
  status: string
  phase: string
  outcome: string | null
  disposition: string | null
  errorReason: string | null
  triggerKind: string
  surface: string
  attemptCount: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  /** How long the intent waited before a worker claimed it. */
  queuedMs: number | null
  /** Intent to settled. Not the same as the customer's wait, which the thread owns. */
  totalMs: number | null
  /** The workflow wait this run answers, when one delegated it. */
  delegation: { workflowRunId: string; nodeId: string; waitSeq: number } | null
}

export interface AssistantRunStepView {
  key: string
  kind: string
  status: string
  attempt: number
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  modelId: string | null
  output: Record<string, JsonValue> | null
  validator: Record<string, JsonValue> | null
}

export interface AssistantRunEvidenceView {
  sourceType: string
  sourceId: string
  sourceVersion: string | null
  chunkId: string | null
  passage: string | null
  audience: string | null
  provenance: string | null
  retrievalRank: number | null
  citationIndex: number | null
}

export interface AssistantRunReceiptView {
  id: string
  toolName: string
  status: string
  outcomeStatus: string | null
  reconciliationState: string | null
  reconciliationNote: string | null
  dispatchedAt: string | null
  settledAt: string | null
  error: string | null
  pendingActionId: string | null
}

export interface AssistantRunApprovalView {
  id: string
  toolName: string
  summary: string
  status: string
  executionState: string | null
  executionError: string | null
  disposition: string | null
  proposedAt: string
  decidedAt: string | null
  executedAt: string | null
}

/** The frozen behaviour, projected down to what an operator can act on. */
export interface AssistantRunBehaviourView {
  contentHash: string
  promptVersion: string | null
  configRevision: number | null
  validatorMode: string | null
  retrievalSourceTypes: string[]
  embeddingModel: string | null
  guidanceCount: number
  releaseNumber: number | null
  releaseStatus: string | null
}

export interface AssistantRunDetail extends AssistantRunSummary {
  steps: AssistantRunStepView[]
  evidence: AssistantRunEvidenceView[]
  receipts: AssistantRunReceiptView[]
  approvals: AssistantRunApprovalView[]
  /** Guidance this turn carried, and what the character budget left out. */
  guidanceAppliedIds: string[]
  guidanceOmittedIds: string[]
  /** The validator's own verdicts, read off the step ledger rather than re-derived. */
  validation: Array<{ step: string; status: string; verdict: Record<string, JsonValue> | null }>
  behaviour: AssistantRunBehaviourView | null
  /** Whether a person may still cancel or re-run this one. Read by the controls. */
  cancellable: boolean
  retryable: boolean
}

const ISO = (value: Date | null | undefined) => (value ? value.toISOString() : null)

function millisBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null
  const ms = to.getTime() - from.getTime()
  return ms >= 0 ? ms : null
}

function toSummary(row: typeof assistantRuns.$inferSelect): AssistantRunSummary {
  return {
    id: row.id,
    conversationId: row.conversationId,
    ticketId: row.ticketId,
    status: row.status,
    phase: row.phase,
    outcome: row.outcome,
    disposition: row.disposition,
    errorReason: row.errorReason,
    triggerKind: row.triggerKind,
    surface: row.surface,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt.toISOString(),
    startedAt: ISO(row.startedAt),
    finishedAt: ISO(row.finishedAt),
    queuedMs: millisBetween(row.createdAt, row.startedAt),
    totalMs: millisBetween(row.createdAt, row.finishedAt),
    delegation: row.delegation ?? null,
  }
}

/** Runs on one conversation, newest first. */
export async function listAssistantRunsForConversation(
  conversationId: ConversationId,
  limit = 20,
  exec: Executor = db
): Promise<AssistantRunSummary[]> {
  const rows = await exec
    .select()
    .from(assistantRuns)
    .where(eq(assistantRuns.conversationId, conversationId))
    .orderBy(desc(assistantRuns.createdAt))
    .limit(Math.max(1, Math.min(limit, 50)))
  return rows.map(toSummary)
}

/** Runs on one ticket, newest first. */
export async function listAssistantRunsForTicket(
  ticketId: TicketId,
  limit = 20,
  exec: Executor = db
): Promise<AssistantRunSummary[]> {
  const rows = await exec
    .select()
    .from(assistantRuns)
    .where(eq(assistantRuns.ticketId, ticketId))
    .orderBy(desc(assistantRuns.createdAt))
    .limit(Math.max(1, Math.min(limit, 50)))
  return rows.map(toSummary)
}

/** The run row alone, for a caller that needs its parent before it reads more. */
export async function findAssistantRunParent(
  runId: AssistantRunId,
  exec: Executor = db
): Promise<{ conversationId: string | null; ticketId: string | null } | null> {
  const [row] = await exec
    .select({
      conversationId: assistantRuns.conversationId,
      ticketId: assistantRuns.ticketId,
    })
    .from(assistantRuns)
    .where(eq(assistantRuns.id, runId))
  return row ?? null
}

const CANCELLABLE_STATUSES = ['queued', 'running', 'waiting_action']

/**
 * A bounded projection of the frozen snapshot.
 *
 * Deliberately not the whole payload. The snapshot is a diagnostic record and
 * carries no credential by construction, but it also carries the entire
 * resolved configuration, and shipping that to a browser because somebody
 * opened a run is more than the question needs.
 */
function toBehaviour(
  snapshot: typeof assistantEffectiveSnapshots.$inferSelect | undefined,
  release: { releaseNumber: number | null; status: string } | undefined
): AssistantRunBehaviourView | null {
  if (!snapshot) return null
  const payload = (snapshot.payload ?? {}) as Record<string, unknown>
  const retrieval = (payload.retrieval ?? {}) as Record<string, unknown>
  const validator = (payload.validator ?? {}) as Record<string, unknown>
  const guidance = Array.isArray(payload.guidance) ? payload.guidance : []
  return {
    contentHash: snapshot.contentHash,
    promptVersion: typeof payload.promptVersion === 'string' ? payload.promptVersion : null,
    configRevision: typeof payload.configRevision === 'number' ? payload.configRevision : null,
    validatorMode: typeof validator.semantic === 'string' ? validator.semantic : null,
    retrievalSourceTypes: Array.isArray(retrieval.sourceTypes)
      ? retrieval.sourceTypes.filter((entry): entry is string => typeof entry === 'string')
      : [],
    embeddingModel: typeof retrieval.embeddingModel === 'string' ? retrieval.embeddingModel : null,
    guidanceCount: guidance.length,
    releaseNumber: release?.releaseNumber ?? null,
    releaseStatus: release?.status ?? null,
  }
}

function idsFrom(output: Record<string, JsonValue> | null, key: string): string[] {
  const value = output?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Everything one run recorded.
 *
 * Returns null for a run that does not exist, so the caller reports a miss
 * rather than distinguishing "gone" from "not yours".
 */
export async function getAssistantRunInspection(
  runId: AssistantRunId,
  exec: Executor = db
): Promise<AssistantRunDetail | null> {
  const [run] = await exec.select().from(assistantRuns).where(eq(assistantRuns.id, runId))
  if (!run) return null

  const [steps, evidence, receipts, approvals] = await Promise.all([
    exec
      .select()
      .from(assistantRunSteps)
      .where(eq(assistantRunSteps.runId, runId))
      .orderBy(assistantRunSteps.startedAt),
    exec
      .select()
      .from(assistantRunEvidence)
      .where(eq(assistantRunEvidence.runId, runId))
      .orderBy(assistantRunEvidence.retrievalRank),
    exec
      .select()
      .from(assistantToolCalls)
      .where(eq(assistantToolCalls.runId, runId))
      .orderBy(assistantToolCalls.createdAt),
    exec
      .select()
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.runId, runId))
      .orderBy(assistantPendingActions.proposedAt),
  ])

  let snapshot: typeof assistantEffectiveSnapshots.$inferSelect | undefined
  let release: { releaseNumber: number | null; status: string } | undefined
  if (run.snapshotId) {
    const [snapshotRow] = await exec
      .select()
      .from(assistantEffectiveSnapshots)
      .where(eq(assistantEffectiveSnapshots.id, run.snapshotId))
    snapshot = snapshotRow
    if (snapshotRow) {
      const [releaseRow] = await exec
        .select({
          releaseNumber: assistantReleases.releaseNumber,
          status: assistantReleases.status,
        })
        .from(assistantReleases)
        .where(
          and(
            eq(assistantReleases.snapshotId, snapshotRow.id),
            inArray(assistantReleases.status, ['published', 'superseded'])
          )
        )
        .orderBy(desc(assistantReleases.createdAt))
        .limit(1)
      release = releaseRow
    }
  }

  const stepViews: AssistantRunStepView[] = steps.map((step) => ({
    key: step.stepKey,
    kind: step.stepKind,
    status: step.status,
    attempt: step.attemptNumber,
    startedAt: step.startedAt.toISOString(),
    finishedAt: ISO(step.finishedAt),
    durationMs: millisBetween(step.startedAt, step.finishedAt),
    modelId: step.modelId,
    output: (step.output ?? null) as Record<string, JsonValue> | null,
    validator: (step.validator ?? null) as Record<string, JsonValue> | null,
  }))

  const generation = stepViews.find((step) => step.key === 'generate')

  return {
    ...toSummary(run),
    steps: stepViews,
    evidence: evidence.map((row) => ({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceVersion: row.sourceVersion,
      chunkId: row.chunkId,
      passage: row.passage,
      audience: row.audience,
      provenance: row.provenance,
      retrievalRank: row.retrievalRank,
      citationIndex: row.citationIndex,
    })),
    receipts: receipts.map((row) => ({
      id: row.id,
      toolName: row.toolName,
      status: row.status,
      outcomeStatus: row.outcomeStatus,
      reconciliationState: row.reconciliationState,
      reconciliationNote: row.reconciliationNote,
      dispatchedAt: ISO(row.dispatchedAt),
      settledAt: ISO(row.settledAt),
      error: row.error,
      pendingActionId: row.pendingActionId,
    })),
    approvals: approvals.map((row) => ({
      id: row.id,
      toolName: row.toolName,
      summary: row.summary,
      status: row.status,
      executionState: row.executionState,
      executionError: row.executionError,
      disposition: row.disposition,
      proposedAt: row.proposedAt.toISOString(),
      decidedAt: ISO(row.decidedAt),
      executedAt: ISO(row.executedAt),
    })),
    guidanceAppliedIds: idsFrom(generation?.output ?? null, 'guidanceAppliedIds'),
    guidanceOmittedIds: idsFrom(generation?.output ?? null, 'guidanceOmittedIds'),
    validation: stepViews
      .filter((step) => step.kind === 'validation')
      .map((step) => ({ step: step.key, status: step.status, verdict: step.validator })),
    behaviour: toBehaviour(snapshot, release),
    cancellable: CANCELLABLE_STATUSES.includes(run.status),
    // Mirrors retryFailedAssistantRun's own precondition on status. The rest of
    // that precondition (no action taken, parent still Quinn's) is re-read at
    // the moment of the click, because either can change while a sheet is open.
    retryable: run.status === 'failed' && !!run.conversationId,
  }
}
