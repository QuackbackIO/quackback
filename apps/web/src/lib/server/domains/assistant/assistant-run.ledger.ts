/**
 * What a durable run did, recorded as it happens.
 *
 * Split out of `assistant-run.repository.ts`, which owns the run row's own
 * state machine and its fences. This module owns the append side: the step
 * ledger, the evidence package and the run's cost counters. Nothing here is a
 * fence, and nothing here decides whether a run may publish.
 */
import { eq, sql, assistantRuns, assistantRunSteps, assistantRunEvidence } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { AssistantRunId } from '@quackback/ids'

export interface RunStepInput {
  runId: AssistantRunId
  stepKey: string
  attemptNumber: number
  stepKind: string
  status?: 'started' | 'succeeded' | 'failed' | 'skipped'
  inputDigest?: string | null
  output?: Record<string, unknown> | null
  modelId?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  toolCallId?: string | null
  validator?: Record<string, unknown> | null
  startedAt?: Date
  finishedAt?: Date | null
}

/**
 * Record one step of a run.
 *
 * Idempotent on (run, step key, attempt): a replay of the same logical step
 * updates the existing row rather than accumulating duplicates, which is what
 * makes the step ledger readable after a retry.
 */
export async function recordRunStep(exec: Executor, input: RunStepInput): Promise<void> {
  await exec
    .insert(assistantRunSteps)
    .values({
      runId: input.runId,
      stepKey: input.stepKey,
      attemptNumber: input.attemptNumber,
      stepKind: input.stepKind,
      status: input.status ?? 'started',
      inputDigest: input.inputDigest ?? null,
      output: input.output ?? null,
      modelId: input.modelId ?? null,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      toolCallId: input.toolCallId ?? null,
      validator: input.validator ?? null,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [assistantRunSteps.runId, assistantRunSteps.stepKey, assistantRunSteps.attemptNumber],
      set: {
        status: input.status ?? 'started',
        output: input.output ?? null,
        modelId: input.modelId ?? null,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        toolCallId: input.toolCallId ?? null,
        validator: input.validator ?? null,
        ...(input.startedAt ? { startedAt: input.startedAt } : {}),
        finishedAt: input.finishedAt ?? null,
      },
    })
}

/**
 * Add one model call's token usage to the run's counters.
 *
 * Accumulated rather than assigned: a turn can reach the provider more than
 * once (the constrained repair, a transport re-dial), and the run's counters
 * are the turn's total cost rather than the last call's. Both columns are
 * `NOT NULL DEFAULT 0`, so the addition is always defined. A count that is
 * missing, negative or not finite adds nothing, because a provider reporting
 * nonsense must not be able to walk a counter backwards.
 */
export async function addRunTokenUsage(
  exec: Executor,
  runId: AssistantRunId,
  usage: { promptTokens?: number | null; completionTokens?: number | null } | null | undefined
): Promise<void> {
  const prompt = safeTokenCount(usage?.promptTokens)
  const completion = safeTokenCount(usage?.completionTokens)
  if (prompt === 0 && completion === 0) return
  await exec
    .update(assistantRuns)
    .set({
      promptTokens: sql`${assistantRuns.promptTokens} + ${prompt}`,
      completionTokens: sql`${assistantRuns.completionTokens} + ${completion}`,
      updatedAt: new Date(),
    })
    .where(eq(assistantRuns.id, runId))
}

function safeTokenCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

export interface RunEvidenceInput {
  runId: AssistantRunId
  attemptNumber: number
  sourceType: string
  sourceId: string
  sourceVersion?: string | null
  chunkId?: string | null
  passage?: string | null
  audience?: string | null
  provenance?: string | null
  retrievalRank?: number | null
  citationIndex?: number | null
}

/** Persist the evidence actually supplied to the model for one attempt. */
export async function recordRunEvidence(
  exec: Executor,
  rows: readonly RunEvidenceInput[]
): Promise<void> {
  if (rows.length === 0) return
  await exec.insert(assistantRunEvidence).values(
    rows.map((row) => ({
      runId: row.runId,
      attemptNumber: row.attemptNumber,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceVersion: row.sourceVersion ?? null,
      chunkId: row.chunkId ?? null,
      passage: row.passage ?? null,
      audience: row.audience ?? null,
      provenance: row.provenance ?? null,
      retrievalRank: row.retrievalRank ?? null,
      citationIndex: row.citationIndex ?? null,
    }))
  )
}
