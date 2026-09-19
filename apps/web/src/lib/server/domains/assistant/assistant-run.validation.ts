/**
 * The semantic validation step of a durable turn (QUINN-PRODUCT P6).
 *
 * Split out of `assistant-run.executor.ts` so the worker-side sequence stays
 * readable: this file owns only the verifier call, the one constrained repair
 * it is allowed, and the run-step record of both verdicts.
 */
import { db, eq, assistantToolCalls } from '@/lib/server/db'
import type { Transaction } from '@/lib/server/db'
import type { AssistantRunId, ConversationId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { recordRunStep, type AssistantRunRow } from './assistant-run.repository'
import type { CommitAssistantOutcomeInput } from './assistant-run.service'
import type { PublicationVerdict } from './publication-validation'

const log = logger.child({ component: 'assistant-run-validation' })

/** An answered candidate, as the executor passes it around. */
type AnsweredTurn = Extract<
  Awaited<ReturnType<typeof import('./assistant.orchestrator').generateAssistantCandidate>>,
  { status: 'answered' | 'cannot_answer' }
>

/**
 * Run the semantic verifier, and give an enforced refusal exactly one repair.
 *
 * The repair is read-only by construction: it re-answers with no write tool
 * assembled at all, so it cannot repeat a business write no matter what the
 * model decides. Only one is allowed, and its own verdict is final: a loop of
 * repairs is a way to spend a customer's wait on the same wrong answer.
 *
 * Both verdicts are recorded on the run whichever mode is active, so shadow
 * mode produces the calibration data enforcement is supposed to graduate on.
 */
export async function verifyAndMaybeRepair(input: {
  run: { id: AssistantRunId; attemptCount: number }
  conversationId: ConversationId
  prepared: Awaited<ReturnType<typeof import('./assistant.orchestrator').prepareAssistantTurn>>
  stepInstructions: string | null
  result: AnsweredTurn
}): Promise<{ kind: 'ok'; result: AnsweredTurn } | { kind: 'blocked'; verdict: string }> {
  const { verifyAnswerSupport, verificationBlocksPublication } = await import('./answer-validation')
  const receipts = await runReceipts(input.run.id)

  const verify = (candidate: AnsweredTurn) =>
    verifyAnswerSupport({
      text: candidate.text,
      responseKind: candidate.responseKind ?? 'clarification',
      handoff: candidate.escalation?.mode === 'handoff',
      evidence: candidate.evidence,
      receipts,
    })

  const first = await verify(input.result)
  await recordVerification(input.run, 'answer_validation', first)
  if (!verificationBlocksPublication(first)) return { kind: 'ok', result: input.result }

  const { generateAssistantCandidate } = await import('./assistant.orchestrator')
  const prepared = input.prepared
  if (!prepared) return { kind: 'blocked', verdict: first.verdict ?? 'validator_error' }

  let repaired: AnsweredTurn
  try {
    const attempt = await generateAssistantCandidate(input.conversationId, prepared, {
      surface: 'widget',
      stepInstructions: [input.stepInstructions, REPAIR_INSTRUCTION].filter(Boolean).join('\n\n'),
      runId: input.run.id,
      readOnlyTools: true,
    })
    if (attempt.status === 'suppressed') {
      return { kind: 'blocked', verdict: first.verdict ?? 'validator_error' }
    }
    repaired = attempt
  } catch (err) {
    log.warn({ err, run_id: input.run.id }, 'constrained repair failed')
    return { kind: 'blocked', verdict: first.verdict ?? 'validator_error' }
  }

  const second = await verify(repaired)
  await recordVerification(input.run, 'answer_validation_repair', second)
  if (verificationBlocksPublication(second)) {
    return { kind: 'blocked', verdict: second.verdict ?? 'validator_error' }
  }
  return { kind: 'ok', result: repaired }
}

/** The one-time instruction the constrained repair carries. */
const REPAIR_INSTRUCTION =
  'Your previous answer was rejected because a material claim was not supported by the retrieved evidence. Answer again using only what the evidence and the workspace guidance actually state. If they do not settle the question, say so plainly and offer to bring in a person. Do not take any action.'

/** This run's normalized tool outcomes, for the verifier's action-claim check. */
async function runReceipts(
  runId: AssistantRunId
): Promise<Array<{ toolName: string; status: string }>> {
  try {
    const rows = await db
      .select({
        toolName: assistantToolCalls.toolName,
        status: assistantToolCalls.status,
        outcomeStatus: assistantToolCalls.outcomeStatus,
      })
      .from(assistantToolCalls)
      .where(eq(assistantToolCalls.runId, runId))
    return rows.map((row) => ({ toolName: row.toolName, status: row.outcomeStatus ?? row.status }))
  } catch (err) {
    log.warn({ err, run_id: runId }, 'could not read this run receipts for validation')
    return []
  }
}

/** Store one verdict on the run, whether or not the verifier ran. */
async function recordVerification(
  run: { id: AssistantRunId; attemptCount: number },
  stepKey: string,
  verification: Awaited<ReturnType<typeof import('./answer-validation').verifyAnswerSupport>>
): Promise<void> {
  await recordRunStep(db, {
    runId: run.id,
    stepKey,
    attemptNumber: run.attemptCount,
    stepKind: 'validation',
    status: verification.ran ? 'succeeded' : 'skipped',
    modelId: verification.model,
    validator: {
      layer: 'semantic',
      mode: verification.mode,
      verdict: verification.verdict,
      skippedReason: verification.skippedReason,
      ...(verification.reason ? { reason: verification.reason } : {}),
      ...(verification.evidenceRefs.length > 0 ? { evidenceRefs: verification.evidenceRefs } : {}),
    },
    finishedAt: new Date(),
  }).catch((err) => log.warn({ err, run_id: run.id }, 'could not record a validation verdict'))
}

/**
 * Run the deterministic validator for one candidate and record its verdict.
 *
 * The verdict is written to the run's own step ledger whichever way it goes, so
 * a refused publication is inspectable as a validator decision rather than as a
 * turn that silently produced nothing. The step write shares this transaction,
 * so a rejection's record commits with the rejection.
 */
export async function runPublicationValidation(
  tx: Transaction,
  run: AssistantRunRow,
  input: CommitAssistantOutcomeInput
): Promise<PublicationVerdict> {
  const citations = input.candidate.citations.map((citation) => ({
    type: citation.type,
    id: citation.id,
    // A persisted citation carries no internal flag by construction: the
    // orchestrator strips it before a customer turn is committed. The internal
    // check therefore reads the evidence rows, which still know.
    internal: input.evidence?.some((row) => row.sourceId === citation.id && row.internal === true),
  }))
  const { eligibleCustomerCitationIds } = await import('./publication-recheck')
  const [eligibleSourceIds, receipts] = await Promise.all([
    citations.length > 0 ? eligibleCustomerCitationIds(citations) : Promise.resolve(null),
    loadRunReceipts(tx, run.id),
  ])

  const { validateCustomerPublication } = await import('./publication-validation')
  const verdict = validateCustomerPublication({
    candidate: {
      text: input.candidate.text,
      responseKind: input.candidate.responseKind,
      outcome: input.candidate.outcome,
      citations,
      handoff: input.candidate.handoff !== null,
      closeRequest: input.candidate.closeRequest === true,
    },
    evidence: (input.evidence ?? []).map((row) => ({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      internal: row.internal === true,
    })),
    receipts,
    eligibleSourceIds,
  })

  await recordRunStep(tx, {
    runId: run.id,
    stepKey: 'publication_validation',
    attemptNumber: run.attemptCount,
    stepKind: 'validation',
    status: verdict.ok ? 'succeeded' : 'failed',
    validator: verdict.ok
      ? { layer: 'deterministic', verdict: 'passed' }
      : { layer: 'deterministic', verdict: 'rejected', code: verdict.code, detail: verdict.detail },
    finishedAt: new Date(),
  })
  return verdict
}

/** This run's tool receipts, reduced to what the validator's receipt rule reads. */
async function loadRunReceipts(
  tx: Transaction,
  runId: AssistantRunId
): Promise<Array<{ toolName: string; status: string }>> {
  const rows = await tx
    .select({
      toolName: assistantToolCalls.toolName,
      status: assistantToolCalls.status,
      outcomeStatus: assistantToolCalls.outcomeStatus,
    })
    .from(assistantToolCalls)
    .where(eq(assistantToolCalls.runId, runId))
  return rows.map((row) => ({ toolName: row.toolName, status: row.outcomeStatus ?? row.status }))
}
