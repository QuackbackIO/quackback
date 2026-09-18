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
import { db } from '@/lib/server/db'
import type { AssistantRunId } from '@quackback/ids'
import type { ConversationAuthorInput } from '@/lib/server/domains/conversation/conversation.types'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import {
  settleRun,
  attachSnapshot,
  recordRunStep,
  claimRunForExecution,
} from './assistant-run.repository'
import { buildEffectiveSnapshot, persistEffectiveSnapshot } from './assistant-snapshot'
import { commitAssistantOutcome } from './assistant-run.service'

const log = logger.child({ component: 'assistant-run-executor' })

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
    // did is written even if the generation then fails.
    try {
      const snapshotId = await persistEffectiveSnapshot(await buildEffectiveSnapshot())
      await attachSnapshot(db, run.id, snapshotId)
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
      output: {
        status: result.status,
        responseKind: result.status === 'suppressed' ? null : (result.responseKind ?? null),
      },
      finishedAt: new Date(),
    })

    if (result.status === 'suppressed') {
      await settleRun(db, {
        runId,
        status: 'suppressed',
        phase: 'validation',
        disposition: 'engine:suppressed',
        expectedLeaseToken: job.leaseToken,
      })
      return 'suppressed'
    }
    // Defense in depth: public delivery is forbidden if any internal context
    // reached the model, even when the model omitted that source from its
    // final citations.
    if (result.internalSourced) throw new InternalSourcedReplyError()

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
        candidate: {
          text: result.text,
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
    return 'failed'
  } finally {
    await clearActivitySnapshot(conversationId)
  }
}
