/**
 * Executing one claimed durable turn.
 *
 * Split from assistant-run.service.ts so the intake and publication seams stay
 * readable on one screen: this file is the worker-side sequence (claim, freeze,
 * generate, publish, settle) and holds no transaction across the model call.
 *
 * Losing a race is a normal outcome here, not an error. The turn job runs with
 * `maxAttempts: 1`, so throwing would burn the only attempt a customer message
 * gets; every fenced outcome is therefore reported as a disposition string and
 * recorded on the run.
 */
import { db, and, eq, assistantPendingActions, type AssistantRunDelegation } from '@/lib/server/db'
import type { AssistantRunId, ConversationId } from '@quackback/ids'
import type { ConversationAuthorInput } from '@/lib/server/domains/conversation/conversation.types'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import { settleRun, attachSnapshot, claimRunForExecution } from './assistant-run.repository'
import { addRunTokenUsage, recordRunStep } from './assistant-run.ledger'
import { selectRunBehaviour } from './assistant-release.service'
import { verifyAndMaybeRepair } from './assistant-run.validation'
import { commitAssistantOutcome, parkRunForAction } from './assistant-run.service'

const log = logger.child({ component: 'assistant-run-executor' })

/**
 * Park the run when the turn it just published left a live proposal behind.
 *
 * Read from the rows rather than from the generation's own report: a proposal
 * is a committed row, and a run that published an acknowledgement for one it
 * cannot see afterwards would be a run that quietly finished owing a result.
 * Returns the proposal's id when the run was parked.
 */
async function parkRunIfActionPending(
  runId: AssistantRunId,
  conversationId: ConversationId
): Promise<string | null> {
  const [pending] = await db
    .select({ id: assistantPendingActions.id })
    .from(assistantPendingActions)
    .where(
      and(
        eq(assistantPendingActions.conversationId, conversationId),
        eq(assistantPendingActions.runId, runId),
        eq(assistantPendingActions.status, 'proposed')
      )
    )
    .limit(1)
  if (!pending) return null
  const parked = await parkRunForAction(db, runId, pending.id)
  return parked ? pending.id : null
}

/**
 * Tell the workflow that delegated this run that Quinn is done with it.
 *
 * Only for an outcome that actually ends the wait: a hand-off, or an execution
 * that produced nothing. An ordinary answer leaves the wait parked, because
 * Quinn answering is not the workflow's resolution branch, and a run parked on
 * an approval still owes a result.
 *
 * Best effort by design. The completion is a second transaction after the run
 * settled, so a process death between them is possible; the workflow sweep
 * reconciles a terminal run against its stranded wait, and the wait's own
 * expiry is the floor under both.
 */
async function completeDelegation(
  run: { id: AssistantRunId; delegation: AssistantRunDelegation | null },
  outcome: 'escalated' | 'resolved'
): Promise<void> {
  if (!run.delegation) return
  try {
    const { completeAssistantDelegation } =
      await import('@/lib/server/domains/workflows/assistant-delegation')
    await completeAssistantDelegation(run.delegation, outcome)
  } catch (err) {
    log.warn(
      { err, event: 'assistant_run.delegation_completion_failed', run_id: run.id },
      'could not resume the delegating workflow wait'
    )
  }
}

/**
 * Execute one claimed turn job.
 *
 * Returns a short disposition string for the caller's log line. Never throws
 * for an ordinary lost race: losing is the designed outcome of two workers
 * meeting, and a thrown error would retry a job whose whole point is to run at
 * most once.
 */
export async function advanceAssistantRun(job: ClaimedJob): Promise<string> {
  const runId = job.payload.runId as AssistantRunId | undefined
  if (!runId) throw new Error('assistant-turn job has no runId')
  const stepInstructions = (job.payload.stepInstructions as string | undefined) ?? null

  const claim = await claimRunForExecution({
    runId,
    jobId: job.jobId,
    leaseToken: job.leaseToken,
  })
  if (claim.kind === 'missing') {
    log.warn({ event: 'assistant_run.missing', run_id: runId }, 'assistant run row is gone')
    return 'missing'
  }
  if (claim.kind === 'already_settled') {
    // The replay path. A previous attempt committed the outcome (or the run was
    // cancelled); finishing quietly is the correct behaviour, and no second
    // message, event or action is produced.
    log.info(
      { event: 'assistant_run.replay', run_id: runId, status: claim.run.status },
      'assistant run already settled; replay finishing without a second outcome'
    )
    return `already_settled:${claim.run.status}`
  }
  if (claim.kind === 'superseded') {
    log.info(
      { event: 'assistant_run.superseded', run_id: runId, reason: claim.reason },
      'assistant run superseded before execution'
    )
    return claim.reason
  }

  const run = claim.run
  const conversationId = run.conversationId
  if (!conversationId) {
    await settleRun(db, {
      runId,
      status: 'failed',
      errorReason: 'durable execution supports conversation runs only',
      disposition: 'unsupported_parent',
    })
    return 'unsupported_parent'
  }

  const runLog = log.child({ run_id: run.id, conversation_id: conversationId, job_id: job.jobId })
  const { clearActivitySnapshot } = await import('./assistant-activity-snapshot')

  try {
    // Freeze the behaviour BEFORE any generation, so the record of what the run
    // did is written even if the generation then fails. With release management
    // on this SELECTS the published release's snapshot instead of building a
    // new one, and the configuration frozen in it is carried through the rest
    // of the turn, so a publication landing mid-generation changes what the
    // NEXT run selects and nothing about this one.
    let runtimeConfig: import('./assistant.runtime').AssistantRuntimeConfig | undefined
    try {
      const behaviour = await selectRunBehaviour()
      await attachSnapshot(db, run.id, behaviour.snapshotId)
      if (behaviour.config) {
        const { getWorkspaceName } = await import('./assistant-release.service')
        runtimeConfig = {
          config: behaviour.config,
          revision: behaviour.configRevision,
          workspaceName: await getWorkspaceName(),
        }
      }
    } catch (err) {
      runLog.warn({ err }, 'effective snapshot could not be persisted')
    }

    const { prepareAssistantTurn, generateAssistantCandidate, InternalSourcedReplyError } =
      await import('./assistant.orchestrator')

    const prepared = await prepareAssistantTurn(conversationId, { surface: run.surface })
    if (!prepared) {
      await settleRun(db, {
        runId,
        status: 'suppressed',
        phase: 'context',
        disposition: 'declined:gate',
        expectedLeaseToken: job.leaseToken,
      })
      runLog.info({ event: 'assistant_run.declined' }, 'assistant run declined at the gates')
      // Quinn will not answer this turn at all, so a workflow waiting on it
      // takes the escalated edge, the same answer the pre-park decline gives.
      await completeDelegation(run, 'escalated')
      return 'declined'
    }

    await recordRunStep(db, {
      runId: run.id,
      stepKey: 'generate',
      attemptNumber: run.attemptCount,
      stepKind: 'generation',
      status: 'started',
    })

    let result: Awaited<ReturnType<typeof generateAssistantCandidate>>
    try {
      result = await generateAssistantCandidate(conversationId, prepared, {
        surface: run.surface,
        stepInstructions,
        runId: run.id,
        requestedByPrincipalId: run.requestedByPrincipalId,
        runtimeConfig,
      })
    } catch (err) {
      await recordRunStep(db, {
        runId: run.id,
        stepKey: 'generate',
        attemptNumber: run.attemptCount,
        stepKind: 'generation',
        status: 'failed',
        finishedAt: new Date(),
      })
      throw err
    }

    await recordRunStep(db, {
      runId: run.id,
      stepKey: 'generate',
      attemptNumber: run.attemptCount,
      stepKind: 'generation',
      status: 'succeeded',
      ...(result.status === 'suppressed'
        ? {}
        : {
            modelId: result.trace.modelId ?? null,
            promptTokens: result.trace.usage?.promptTokens ?? null,
            completionTokens: result.trace.usage?.completionTokens ?? null,
          }),
      output: {
        status: result.status,
        responseKind: result.status === 'suppressed' ? null : (result.responseKind ?? null),
        // What guidance this turn actually carried, and what the character
        // budget left out. The inspector reads these off the step rather than
        // guessing from the snapshot, which records what was available.
        ...(result.status === 'suppressed'
          ? {}
          : {
              guidanceAppliedIds: result.trace.appliedGuidance.map((entry) => entry.id),
              guidanceOmittedIds: result.trace.omittedGuidance.map((entry) => entry.id),
            }),
      },
      finishedAt: new Date(),
    })
    if (result.status !== 'suppressed') {
      // The run's own counters, so the inspector can show what a turn cost
      // without joining a usage log that carries no run id.
      await addRunTokenUsage(db, run.id, result.trace.usage)
    }

    if (result.status === 'suppressed') {
      await settleRun(db, {
        runId,
        status: 'suppressed',
        phase: 'validation',
        disposition: 'engine:suppressed',
        expectedLeaseToken: job.leaseToken,
      })
      await completeDelegation(run, 'escalated')
      return 'suppressed'
    }
    // Defense in depth: public delivery is forbidden if any internal context
    // reached the model, even when the model omitted that source from its
    // final citations.
    if (result.internalSourced) throw new InternalSourcedReplyError()

    // The semantic layer. Shadow by default: it records a verdict and changes
    // nothing. In enforced mode it gets one constrained repair, and a candidate
    // that is still unsupported goes to the handoff floor rather than being
    // published or being recorded as a resolution.
    const verified = await verifyAndMaybeRepair({
      run,
      conversationId,
      prepared,
      stepInstructions,
      result,
      runtimeConfig,
    })
    if (verified.kind === 'blocked') {
      await settleRun(db, {
        runId,
        status: 'suppressed',
        phase: 'validation',
        disposition: `validation:${verified.verdict}`,
        expectedLeaseToken: job.leaseToken,
      })
      runLog.info(
        { event: 'assistant_run.unsupported', verdict: verified.verdict },
        'assistant candidate refused by the semantic verifier'
      )
      // Not a resolution and not an answer: the customer is handed to a person.
      const { runAssistantFailureFloor } = await import('./assistant.orchestrator')
      await runAssistantFailureFloor(conversationId, prepared.assistantPrincipalId)
      await completeDelegation(run, 'escalated')
      return `validation:${verified.verdict}`
    }
    result = verified.result

    const author: ConversationAuthorInput = {
      principalId: prepared.assistantPrincipalId,
      displayName: result.identity.name,
      avatarUrl: result.identity.avatarUrl,
    }

    const outcome = await db.transaction((tx) =>
      commitAssistantOutcome(tx, {
        runId: run.id,
        conversationId,
        expectedInputRevision: run.inputRevision,
        expectedStateVersion: run.stateVersion,
        jobLeaseToken: job.leaseToken,
        author,
        // The exact passages the generator saw, in supply order, with the ones
        // the answer cited marked. Recorded with the outcome so a published
        // answer can be checked against the evidence it was allowed to use.
        evidence: result.evidence.map((row) => ({
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          sourceVersion: row.sourceVersion,
          chunkId: row.chunkId,
          passage: row.passage,
          audience: row.audience,
          provenance: row.provenance,
          retrievalRank: row.retrievalRank,
          citationIndex: row.citationIndex,
          internal: row.internal,
        })),
        candidate: {
          text: result.text,
          closeRequest: result.closeRequest !== undefined,
          // Mirrors the legacy orchestrator exactly: an unclassified reply is a
          // clarification, which keeps it out of the assumed-resolution path.
          responseKind: result.responseKind ?? 'clarification',
          outcome:
            result.status === 'cannot_answer'
              ? 'inability'
              : (result.responseKind ?? 'clarification'),
          citations: result.citations.map((c) => ({
            type: c.type,
            id: c.id,
            title: c.title,
            url: c.url,
          })),
          handoff:
            result.escalation?.mode === 'handoff'
              ? {
                  reason: result.escalation.reason,
                  customerNeed: result.escalation.customerNeed,
                  attempted: result.escalation.attempted,
                  recommendedNextStep: result.escalation.recommendedNextStep,
                }
              : null,
        },
      })
    )

    if (outcome.kind === 'already_published') {
      runLog.info({ event: 'assistant_run.replay_published' }, 'outcome was already committed')
      return 'already_published'
    }
    if (outcome.kind === 'rejected') {
      await settleRun(db, {
        runId,
        status: outcome.reason === 'fence:input_revision' ? 'superseded' : 'cancelled',
        phase: 'publication',
        disposition: outcome.reason,
      })
      runLog.info(
        { event: 'assistant_run.fenced', reason: outcome.reason },
        'assistant candidate refused publication'
      )
      return outcome.reason
    }

    // After-commit effects only, and only for an outcome that is durable. The
    // outbox row is already committed; these are the fire-and-forget reactions
    // that read the database and so must not run before it has the message.
    const { publishAssistantReplyEffects } =
      await import('@/lib/server/domains/conversation/conversation.service')
    await publishAssistantReplyEffects(outcome.publication, author)
    const { runEventSideHooks } = await import('@/lib/server/events/process')
    runEventSideHooks(outcome.sideHookEvent)

    // Quinn asked to close the thread. A lifecycle transition of its own, so it
    // runs after publication and invalidates any later in-flight work itself.
    if (result.closeRequest) {
      const { endConversation } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await endConversation(conversationId, 'resolved', result.closeRequest.reason, {
        principalId: prepared.assistantPrincipalId,
        principalType: 'service',
        role: 'member',
        segmentIds: new Set(),
      })
      const { classifyConversationAttributes } =
        await import('@/lib/server/domains/conversation-attributes/ai-classification.service')
      await classifyConversationAttributes(conversationId, {
        trigger: 'assistant_closed',
      }).catch((err) => runLog.warn({ err }, 'post-close classification failed'))
      if (outcome.involvementId) {
        const { recordOutcome } = await import('./assistant.involvement')
        await recordOutcome(
          outcome.involvementId as Parameters<typeof recordOutcome>[0],
          'confirmed'
        )
      }
    }

    if (outcome.handoff) {
      const { appendAssistantHandoffNote, executeAssistantHandoff } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await Promise.all([
        appendAssistantHandoffNote(
          conversationId,
          {
            reason: outcome.handoff.reason,
            customerNeed: outcome.handoff.customerNeed,
            attempted: outcome.handoff.attempted,
            recommendedNextStep: outcome.handoff.recommendedNextStep,
          },
          author
        ),
        executeAssistantHandoff(conversationId, outcome.handoff.reason, author),
      ])
      // The delegating workflow's escalated edge, named by this run's own
      // delegation rather than by whichever wait happens to be parked now.
      await completeDelegation(run, 'escalated')
    }

    // The turn published an acknowledgement and now owes a result: a write tool
    // resolved to a proposal that is still waiting on a teammate. Park the run
    // so the worker slot is released while the decision is outstanding, and so
    // the conversation records that Quinn owes something. The result arrives as
    // its own continuation run, not as a resumption of this one, which is what
    // keeps a customer message during the wait from stranding the action.
    const parked = await parkRunIfActionPending(run.id, conversationId)
    if (parked) {
      runLog.info(
        { event: 'assistant_run.waiting_action', pending_action_id: parked },
        'assistant run parked on an approval'
      )
      return 'waiting_action'
    }

    runLog.info(
      { event: 'assistant_run.published', outcome: outcome.run.outcome },
      'assistant run published'
    )
    return 'published'
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      await settleRun(db, {
        runId,
        status: 'cancelled',
        disposition: 'aborted',
        errorReason: 'generation aborted',
      })
      return 'aborted'
    }
    runLog.error({ err, event: 'assistant_run.failed' }, 'assistant run failed')
    await settleRun(db, {
      runId,
      status: 'failed',
      disposition: 'error',
      errorReason: err instanceof Error ? err.message.slice(0, 500) : 'unknown error',
    })
    // The customer is still waiting. The failure floor hands them to a human
    // using fresh reads, so it stands down if somebody already took over.
    try {
      const { runAssistantFailureFloor } = await import('./assistant.orchestrator')
      const [{ assistantPrincipalIdOnce }] = await Promise.all([
        import('@/lib/server/messages/assistant-principal'),
      ])
      const principalId = await assistantPrincipalIdOnce()
      if (principalId) await runAssistantFailureFloor(conversationId, principalId)
    } catch (floorErr) {
      runLog.error({ err: floorErr }, 'assistant failure floor could not hand off')
    }
    // Execution died: the workflow's escalated edge, not a resolution.
    await completeDelegation(run, 'escalated')
    return 'failed'
  } finally {
    await clearActivitySnapshot(conversationId)
  }
}
