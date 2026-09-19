/**
 * Kill-point proofs for replayable tool receipts and durable approvals.
 *
 * Real PostgreSQL, committed rows, the real queue. A "kill point" here is the
 * database state a process death actually leaves behind, reproduced by running
 * the first half of a sequence and then starting the second half from scratch,
 * rather than by mocking a return value. The three the specification names are
 * each their own case: before the dispatch, after the effect and before the
 * receipt, and before the job completed.
 *
 * Nothing here mocks a claim, a receipt or a decision. Those are the mechanism
 * under test, and a double that returned the answer the assertion wants would
 * pass against the broken code as readily as against the fixed code.
 *
 * What IS mocked is realtime fan-out and the notification side of the
 * conversation domain: neither participates in a transaction, and both need a
 * live pub/sub connection.
 */
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest'

process.env.BASE_URL = 'http://localhost:4319'
process.env.SECRET_KEY = 'assistant-action-durability-secret-at-least-32-chars'

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationUpdate: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationOnlyEvent: vi.fn(),
}))
vi.mock('@/lib/server/domains/conversation/conversation.notify', () => ({
  notifyAgentReply: vi.fn(async () => {}),
  notifyVisitorMessage: vi.fn(),
  notifyConversationStarted: vi.fn(),
}))

import {
  db,
  and,
  eq,
  sql,
  conversations,
  conversationMessages,
  assistantPendingActions,
  assistantRuns,
  assistantToolCalls,
  assistantReleases,
  principal,
  settings,
} from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { AssistantPendingActionId, ConversationId, PrincipalId } from '@quackback/ids'
import {
  claimToolCall,
  findToolReceipt,
  listUnreconciledToolCalls,
  markToolCallDispatched,
  reconcileToolCall,
  settleToolCall,
} from '../tool-audit'
import { digestOf, pendingActionKey, replayOutcomeFor } from '../tool-receipts'
import { executeApprovedPendingAction } from '../assistant.tools'
import {
  ASSISTANT_ACTION_QUEUE,
  assistantActionDedupeKey,
  decideAndEnqueuePendingAction,
  getPendingActionById,
  proposePendingAction,
  refusePendingAction,
  supersedePendingActions,
  type AssistantPendingAction,
} from '../pending-actions.service'
import { ownershipForActionResult } from '../assistant-action.continuation'
import { resolveApprovedAction } from '../assistant-action.executor'
import { parkRunForAction, requestAssistantTurn } from '../assistant-run.service'
import { loadRun } from '../assistant-run.repository'
import type { AssistantToolContext, AssistantToolSpec } from '../assistant.toolspec'

/**
 * Opt-in, on a database of its own: `quackback_quinn_s5`.
 *
 * This suite commits rows on purpose. A receipt exists so an effect can outlive
 * the transaction that recorded it, so a fixture that rolled everything back
 * could not observe the property under test; several suites sharing the
 * ordinary test database assert whole-table state, so this one is inert
 * anywhere else.
 *
 * It does not share Step 3's `quackback_quinn_runs` either, and the reason is
 * specific: a continuation enqueues an `assistant-turn` job, the queue poller
 * is FIFO per queue, and vitest runs the two files in parallel workers. One
 * row of this suite's in-flight work would make one of that suite's claims
 * fail for a reason that has nothing to do with what it tests, intermittently.
 * Separate databases are the only cleanup that does not depend on timing.
 */
const dedicated = !!process.env.TEST_DATABASE_URL?.includes('quinn_s5')
const tableAvailable = dedicated
  ? await db.execute(sql`SELECT to_regclass('public.assistant_tool_calls') AS t`).then(
      (result) => !!getExecuteRows<{ t: string | null }>(result)[0]?.t,
      () => false
    )
  : false
const available = dedicated && tableAvailable

let visitorId: PrincipalId
let quinnId: PrincipalId
let reviewerId: PrincipalId
const created: ConversationId[] = []

const SUBJECT = 'durable action fixture'

async function newConversation(): Promise<ConversationId> {
  const [row] = await db
    .insert(conversations)
    .values({
      visitorPrincipalId: visitorId,
      channel: 'messenger',
      source: 'widget',
      status: 'open',
      subject: SUBJECT,
    })
    .returning()
  created.push(row.id)
  return row.id
}

/** A write tool whose behaviour each case controls, with no catalogue involved. */
function fakeSpec(
  execute: (args: unknown) => Promise<unknown>,
  overrides: Partial<AssistantToolSpec> = {}
): AssistantToolSpec {
  return {
    name: 'issue_refund',
    label: 'Issue refund',
    description: 'Refund an order.',
    promptGuidance: '',
    risk: 'write',
    permissions: [],
    parents: ['conversation'],
    definition: { name: 'issue_refund', inputSchema: {} } as never,
    execute: (args: unknown) => execute(args),
    summarize: () => 'Issue refund',
    ...overrides,
  } as AssistantToolSpec
}

function toolCtx(): AssistantToolContext {
  return { assistantPrincipalId: quinnId } as unknown as AssistantToolContext
}

async function proposal(
  conversationId: ConversationId,
  overrides: Partial<AssistantPendingAction> = {}
): Promise<AssistantPendingAction> {
  const args = (overrides.args as Record<string, unknown>) ?? { orderId: 'A1' }
  const row = await proposePendingAction({
    conversationId,
    toolName: 'issue_refund',
    args,
    summary: 'Issue refund for A1',
    argsDigest: digestOf(args),
    requestedById: visitorId,
    ...(overrides.runId ? { runId: overrides.runId } : {}),
    ...(overrides.contractDigest ? { contractDigest: overrides.contractDigest } : {}),
  })
  if (Object.keys(overrides).length === 0) return row
  const [updated] = await db
    .update(assistantPendingActions)
    .set(overrides)
    .where(eq(assistantPendingActions.id, row.id))
    .returning()
  return updated
}

async function receiptsFor(conversationId: ConversationId) {
  return db
    .select()
    .from(assistantToolCalls)
    .where(eq(assistantToolCalls.conversationId, conversationId))
}

async function actionJobs(id: AssistantPendingActionId) {
  return getExecuteRows<{ job_id: string; status: string }>(
    await db.execute(sql`
      SELECT job_id, status FROM job_queue
      WHERE queue = ${ASSISTANT_ACTION_QUEUE} AND dedupe_key = ${assistantActionDedupeKey(id)}
    `)
  )
}

beforeAll(async () => {
  if (!available) return
  const [visitor] = await db
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  visitorId = visitor.id
  const [quinn] = await db
    .insert(principal)
    .values({
      role: 'member',
      type: 'service',
      displayName: 'Quinn',
      serviceMetadata: { kind: 'integration', integrationType: 'assistant' },
      createdAt: new Date(),
    })
    .returning()
  quinnId = quinn.id
  const [reviewer] = await db
    .insert(principal)
    .values({ role: 'member', type: 'user', displayName: 'Reviewer', createdAt: new Date() })
    .returning()
  reviewerId = reviewer.id
  // Leftovers from an aborted earlier run: the queue is FIFO per queue name,
  // so one stale pending row makes every later claim in this file wait on work
  // that has nothing to do with it.
  await db.execute(sql`DELETE FROM job_queue WHERE queue = ${ASSISTANT_ACTION_QUEUE}`)
  await db.delete(conversations).where(eq(conversations.subject, SUBJECT))
})

/**
 * Leave the queue empty after every case.
 *
 * Both queues, not just this file's own: a continuation enqueues an
 * `assistant-turn` job, and `claimById` is FIFO per queue, so one row left
 * behind makes a later case in ANOTHER file unclaimable for a reason that has
 * nothing to do with what it tests.
 */
async function clearJobs(): Promise<void> {
  await db.execute(sql`DELETE FROM job_queue WHERE queue = ${ASSISTANT_ACTION_QUEUE}`)
  if (created.length === 0) return
  await db.execute(sql`
    DELETE FROM job_queue
    WHERE queue = 'assistant-turn'
      AND payload->>'conversationId' = ANY(${sql.raw(`ARRAY[${created.map((id) => `'${id}'`).join(',')}]`)})
  `)
}

afterEach(async () => {
  if (!available) return
  await clearJobs()
})

afterAll(async () => {
  if (!available) return
  await clearJobs()
  for (const id of created) await db.delete(conversations).where(eq(conversations.id, id))
  for (const id of [reviewerId, quinnId, visitorId]) {
    if (id) await db.delete(principal).where(eq(principal.id, id))
  }
})

describe.skipIf(!available)('tool receipts: kill points', () => {
  it('kill point before dispatch: a retry finds the open receipt and waits instead of executing', async () => {
    const conversationId = await newConversation()
    const actionKey = `${conversationId}:inv:none:issue_refund:${digestOf({ orderId: 'A1' })}`
    // First half of the sequence, then nothing: the process died between the
    // claim and the provider call.
    const claimed = await claimToolCall({
      conversationId,
      toolName: 'issue_refund',
      args: { orderId: 'A1' },
      actionKey,
      idempotencyKey: `${conversationId}:msg_1:issue_refund`,
      replayStrategy: 'external_uncertain',
    })
    expect(claimed).toBeTruthy()

    // A second worker computes the same logical action from a DIFFERENT turn
    // key, which is the case the action key exists for.
    const second = await claimToolCall({
      conversationId,
      toolName: 'issue_refund',
      args: { orderId: 'A1' },
      actionKey,
      idempotencyKey: `${conversationId}:msg_2:issue_refund`,
      replayStrategy: 'external_uncertain',
    })
    expect(second, 'the same logical action must not be claimable twice').toBeNull()

    const found = await findToolReceipt({ actionKey })
    expect(replayOutcomeFor(found!).status).toBe('in_progress')
    expect(await receiptsFor(conversationId)).toHaveLength(1)
  })

  it('kill point after the effect and before the receipt: the outcome is unknown, never a retry', async () => {
    const conversationId = await newConversation()
    const actionKey = `${conversationId}:kp2:issue_refund`
    const claimed = await claimToolCall({
      conversationId,
      toolName: 'issue_refund',
      args: { orderId: 'A2' },
      actionKey,
      replayStrategy: 'external_uncertain',
    })
    // The intent commit. Everything after this line is what the dead process
    // never got to do.
    await markToolCallDispatched(claimed!.id)

    const found = await findToolReceipt({ actionKey })
    const replay = replayOutcomeFor(found!)
    expect(replay).toMatchObject({ status: 'unknown', reconciliationRequired: true })
    // And the operator surface can see it, which is the only way it ever
    // leaves this state.
    const queue = await listUnreconciledToolCalls(100)
    expect(queue.map((row) => row.id)).toContain(claimed!.id)
  })

  it('a person resolving an unknown effect settles it without repeating the write', async () => {
    const conversationId = await newConversation()
    const claimed = await claimToolCall({
      conversationId,
      toolName: 'issue_refund',
      args: { orderId: 'A3' },
      actionKey: `${conversationId}:kp3:issue_refund`,
      replayStrategy: 'external_uncertain',
    })
    await markToolCallDispatched(claimed!.id)

    const resolved = await reconcileToolCall(claimed!.id, {
      verdict: 'resolved',
      note: 'Checked the provider; the refund is there.',
      principalId: reviewerId,
    })
    expect(resolved).toMatchObject({ reconciliationState: 'resolved', outcomeStatus: 'succeeded' })
    expect(replayOutcomeFor(resolved!).status).toBe('succeeded')
    expect(await receiptsFor(conversationId)).toHaveLength(1)
  })

  it('an uncertain external call that throws is quarantined, not failed', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)
    await db
      .update(assistantPendingActions)
      .set({ status: 'approved', decidedById: reviewerId, decidedAt: new Date() })
      .where(eq(assistantPendingActions.id, action.id))

    const outcome = await executeApprovedPendingAction(
      fakeSpec(
        async () => {
          throw new Error('socket hang up')
        },
        { replayStrategy: 'external_uncertain', connector: { name: 'Billing', initials: 'BI' } }
      ),
      { ...action, status: 'approved' },
      toolCtx()
    )
    expect(outcome.status).toBe('unknown')

    const [receipt] = await receiptsFor(conversationId)
    expect(receipt).toMatchObject({
      status: 'started',
      outcomeStatus: 'unknown',
      reconciliationState: 'required',
      retryable: false,
    })
    expect(receipt.dispatchedAt, 'an external call is stamped before it leaves').not.toBeNull()
    expect(receipt.settledAt, 'nothing about an unknown outcome is settled').toBeNull()
  })

  it('a local mutation that throws is a definite failure, because nothing left this database', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)
    await db
      .update(assistantPendingActions)
      .set({ status: 'approved', decidedById: reviewerId, decidedAt: new Date() })
      .where(eq(assistantPendingActions.id, action.id))

    const outcome = await executeApprovedPendingAction(
      fakeSpec(async () => {
        throw new Error('constraint violation')
      }),
      { ...action, status: 'approved' },
      toolCtx()
    )
    expect(outcome.status).toBe('failed')
    const [receipt] = await receiptsFor(conversationId)
    expect(receipt.dispatchedAt).toBeNull()
    expect(receipt).toMatchObject({ status: 'failed', outcomeStatus: 'failed' })
  })

  it('never audits a fulfilled ok:false envelope as a success', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)
    await db
      .update(assistantPendingActions)
      .set({ status: 'approved', decidedById: reviewerId, decidedAt: new Date() })
      .where(eq(assistantPendingActions.id, action.id))

    const outcome = await executeApprovedPendingAction(
      fakeSpec(async () => ({ ok: false, data: '', note: 'Card declined.' })),
      { ...action, status: 'approved' },
      toolCtx()
    )
    expect(outcome.status).toBe('failed')
    const [receipt] = await receiptsFor(conversationId)
    expect(receipt.status).toBe('failed')
    expect(receipt.outcomeStatus).toBe('failed')
    expect(receipt.retryable).toBe(false)
  })

  it('executes a supported action exactly once across two attempts of the same decision', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)
    await db
      .update(assistantPendingActions)
      .set({ status: 'approved', decidedById: reviewerId, decidedAt: new Date() })
      .where(eq(assistantPendingActions.id, action.id))
    let calls = 0
    const spec = fakeSpec(async () => {
      calls += 1
      return { refundId: 'r_1' }
    })
    const approved = { ...action, status: 'approved' as const }

    const first = await executeApprovedPendingAction(spec, approved, toolCtx())
    // The job died before it could complete, so the queue hands it back.
    const second = await executeApprovedPendingAction(spec, approved, toolCtx())

    expect(first.status).toBe('executed')
    expect(second.status).toBe('skipped_duplicate')
    expect(calls, 'the effect must happen exactly once').toBe(1)
    expect(await receiptsFor(conversationId)).toHaveLength(1)
    // The replay carries the stored result, so a continuation can report the
    // real outcome instead of guessing at one.
    expect(second.status === 'skipped_duplicate' ? second.previous : null).toMatchObject({
      status: 'succeeded',
      value: { refundId: 'r_1' },
    })
  })

  it('keys the approved execution on the decision, not on the turn that proposed it', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)
    await db
      .update(assistantPendingActions)
      .set({ status: 'approved', decidedById: reviewerId, decidedAt: new Date() })
      .where(eq(assistantPendingActions.id, action.id))
    await executeApprovedPendingAction(
      fakeSpec(async () => ({ ok: true })),
      { ...action, status: 'approved' },
      toolCtx()
    )
    const [receipt] = await receiptsFor(conversationId)
    expect(receipt.actionKey).toBe(pendingActionKey(action.id))
    expect(receipt.pendingActionId).toBe(action.id)
  })
})

describe.skipIf(!available)('durable approvals', () => {
  it('commits the decision and the execution job together', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)

    const settled = await decideAndEnqueuePendingAction({
      id: action.id,
      decision: 'approved',
      decidedById: reviewerId,
      approvedArgsDigest: digestOf({ orderId: 'A1' }),
    })

    expect(settled?.action).toMatchObject({ status: 'approved', executionState: 'queued' })
    const jobs = await actionJobs(action.id)
    expect(jobs, 'the decision must leave claimable work behind').toHaveLength(1)
    expect(settled?.action.executionJobId).toBe(jobs[0].job_id)
    // Approved is not executed. A card that read the decision as completion
    // would be lying about an effect nobody has attempted yet.
    expect(settled?.action.executedAt).toBeNull()
  })

  it('two reviewers deciding one proposal: the second sees the decision and enqueues nothing', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)

    const [first, second] = await Promise.all([
      decideAndEnqueuePendingAction({
        id: action.id,
        decision: 'approved',
        decidedById: reviewerId,
      }),
      decideAndEnqueuePendingAction({ id: action.id, decision: 'rejected', decidedById: quinnId }),
    ])

    const winners = [first, second].filter(Boolean)
    expect(winners, 'exactly one decision may win').toHaveLength(1)
    const stored = await getPendingActionById(action.id)
    expect(stored?.decidedById).toBe(winners[0]!.action.decidedById)
    const jobs = await actionJobs(action.id)
    expect(jobs.length).toBeLessThanOrEqual(1)
  })

  it('kill point before job completion: a replay finds a settled proposal and does nothing', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)
    await decideAndEnqueuePendingAction({
      id: action.id,
      decision: 'approved',
      decidedById: reviewerId,
    })
    // The worker executed and settled, then died before marking the job done.
    await db
      .update(assistantPendingActions)
      .set({ status: 'executed', executionState: 'succeeded', executedAt: new Date() })
      .where(eq(assistantPendingActions.id, action.id))

    const replay = await getPendingActionById(action.id)
    expect(replay?.status).toBe('executed')
    // The retry's own guard: nothing but an `approved` row is executable, so
    // the second attempt has nothing to do.
    const settledAgain = await decideAndEnqueuePendingAction({
      id: action.id,
      decision: 'approved',
      decidedById: reviewerId,
    })
    expect(settledAgain).toBeNull()
  })

  // P7: a published release freezes configured behaviour and nothing else. The
  // case above, run again with a release selected, has to give the same answer:
  // if it did not, the release would be holding a withdrawn authority open.
  it('a revoked permission still blocks the action when a release is live', async () => {
    // This database is this suite's own and carries no workspace row of its
    // own; the release path needs one, so create it rather than skipping, which
    // would make the case pass by not running.
    const existing = await db.select({ id: settings.id }).from(settings).limit(1)
    const row =
      existing[0] ??
      (
        await db
          .insert(settings)
          .values({
            name: 'Action durability workspace',
            slug: `s5_${Math.random().toString(36).slice(2, 10)}`,
            createdAt: new Date(),
          })
          .returning({ id: settings.id })
      )[0]
    await db.delete(assistantReleases)
    const { setReleaseManagement } = await import('../assistant-release.publish')
    const { selectRunBehaviour } = await import('../assistant-release.service')
    try {
      await setReleaseManagement(true, quinnId)
      const behaviour = await selectRunBehaviour()
      expect(
        behaviour.releaseId,
        'a release must be live for this case to mean anything'
      ).not.toBeNull()

      const conversationId = await newConversation()
      const action = await proposal(conversationId)
      await decideAndEnqueuePendingAction({
        id: action.id,
        decision: 'approved',
        decidedById: reviewerId,
      })
      await db.delete(principal).where(eq(principal.id, reviewerId))
      const approved = (await getPendingActionById(action.id))!

      expect(await resolveApprovedAction(approved)).toEqual({
        ok: false,
        refusal: 'approver_gone',
      })
      expect(await receiptsFor(conversationId), 'nothing may be dispatched').toHaveLength(0)

      const [restored] = await db
        .insert(principal)
        .values({ role: 'member', type: 'user', displayName: 'Reviewer', createdAt: new Date() })
        .returning()
      reviewerId = restored.id
    } finally {
      await db
        .update(settings)
        .set({ assistantReleaseManagement: false, assistantPublishedReleaseId: null })
        .where(eq(settings.id, row.id))
      await db.delete(assistantReleases)
    }
  })

  it('a revoked permission blocks an approved action and records the reason', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)
    await decideAndEnqueuePendingAction({
      id: action.id,
      decision: 'approved',
      decidedById: reviewerId,
    })
    // The approver's account is gone by the time the worker runs, which is the
    // strongest form of "the borrowed authority is no longer there".
    await db.delete(principal).where(eq(principal.id, reviewerId))
    const approved = (await getPendingActionById(action.id))!

    const resolved = await resolveApprovedAction(approved)
    expect(resolved).toEqual({ ok: false, refusal: 'approver_gone' })
    await refusePendingAction(action.id, { reason: 'approver_gone', note: 'no account' })

    const stored = await getPendingActionById(action.id)
    expect(stored).toMatchObject({
      status: 'failed',
      executionState: 'failed',
      disposition: 'refused:approver_gone',
    })
    expect(await receiptsFor(conversationId), 'nothing may be dispatched').toHaveLength(0)

    const [restored] = await db
      .insert(principal)
      .values({ role: 'member', type: 'user', displayName: 'Reviewer', createdAt: new Date() })
      .returning()
    reviewerId = restored.id
  })

  it('a changed request supersedes an undispatched proposal rather than expiring it silently', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)

    const superseded = await supersedePendingActions({ conversationId }, 'changed_intent')

    expect(superseded.map((row) => row.id)).toContain(action.id)
    const stored = await getPendingActionById(action.id)
    expect(stored).toMatchObject({ status: 'expired', disposition: 'superseded:changed_intent' })
    // And a decided proposal is out of reach: cancelling an intent cannot undo
    // an effect somebody already authorized.
    const other = await proposal(conversationId, {
      args: { orderId: 'B9' },
    } as Partial<AssistantPendingAction>)
    await decideAndEnqueuePendingAction({
      id: other.id,
      decision: 'approved',
      decidedById: reviewerId,
    })
    const afterDecision = await supersedePendingActions({ conversationId }, 'changed_intent')
    expect(afterDecision.map((row) => row.id)).not.toContain(other.id)
  })
})

describe.skipIf(!available)('continuation and ownership', () => {
  it('parks the run on a live proposal and resumes it as a continuation under the fence', async () => {
    const conversationId = await newConversation()
    const requested = await db.transaction((tx) =>
      requestAssistantTurn(tx, {
        conversationId,
        triggerKey: `conversation:${conversationId}:message:kp-park`,
        triggerKind: 'customer_message',
        surface: 'widget',
      })
    )
    // The turn published its acknowledgement and then parked.
    await db
      .update(assistantRuns)
      .set({ status: 'running' })
      .where(eq(assistantRuns.id, requested.run.id))
    const action = await proposal(conversationId, {
      runId: requested.run.id,
    } as Partial<AssistantPendingAction>)
    const parked = await parkRunForAction(db, requested.run.id, action.id)
    expect(parked?.status).toBe('waiting_action')

    await db
      .update(assistantPendingActions)
      .set({ status: 'approved', decidedById: reviewerId, executionState: 'succeeded' })
      .where(eq(assistantPendingActions.id, action.id))
    const approved = (await getPendingActionById(action.id))!

    const continued = await ownershipForActionResult(approved, {
      kind: 'succeeded',
      note: 'Refund issued',
    })

    expect(continued.kind).toBe('continuation')
    // The parked run is finished, and the result travels as a NEW run through
    // every publication fence rather than resuming a row a later customer
    // message may already have superseded.
    const settledParked = await loadRun(db, requested.run.id)
    expect(settledParked?.status).toBe('succeeded')
    expect(settledParked?.disposition).toBe('action:succeeded')
    if (continued.kind === 'continuation') {
      expect(continued.run.run.triggerKey).toBe(`action:${action.id}:result`)
      expect(continued.run.run.id).not.toBe(requested.run.id)
      expect(continued.run.inputRevision).toBeGreaterThan(requested.inputRevision)
    }
  })

  it('a customer message during the approval supersedes the parked run and strands nothing', async () => {
    const conversationId = await newConversation()
    const first = await db.transaction((tx) =>
      requestAssistantTurn(tx, {
        conversationId,
        triggerKey: `conversation:${conversationId}:message:kp-strand-1`,
        triggerKind: 'customer_message',
        surface: 'widget',
      })
    )
    await db
      .update(assistantRuns)
      .set({ status: 'running' })
      .where(eq(assistantRuns.id, first.run.id))
    const action = await proposal(conversationId, {
      runId: first.run.id,
    } as Partial<AssistantPendingAction>)
    await parkRunForAction(db, first.run.id, action.id)

    // The customer keeps talking while the approval is outstanding.
    await db.transaction((tx) =>
      requestAssistantTurn(tx, {
        conversationId,
        triggerKey: `conversation:${conversationId}:message:kp-strand-2`,
        triggerKind: 'customer_message',
        surface: 'widget',
      })
    )

    // The parked run loses, as any open run does against newer input.
    expect((await loadRun(db, first.run.id))?.status).toBe('superseded')
    // The ACTION does not. It is still decidable, which is the whole reason
    // the result arrives as its own continuation rather than as a resumption
    // of a run a later message may already have taken away.
    expect((await getPendingActionById(action.id))?.status).toBe('proposed')
  })

  it('a later turn proposing the same tool supersedes the undispatched card', async () => {
    const conversationId = await newConversation()
    const firstRun = await db.transaction((tx) =>
      requestAssistantTurn(tx, {
        conversationId,
        triggerKey: `conversation:${conversationId}:message:kp-replace-1`,
        triggerKind: 'customer_message',
        surface: 'widget',
      })
    )
    const original = await proposePendingAction({
      conversationId,
      toolName: 'issue_refund',
      args: { orderId: 'A1' },
      summary: 'Issue refund for A1',
      runId: firstRun.run.id,
      argsDigest: digestOf({ orderId: 'A1' }),
    })
    const secondRun = await db.transaction((tx) =>
      requestAssistantTurn(tx, {
        conversationId,
        triggerKey: `conversation:${conversationId}:message:kp-replace-2`,
        triggerKind: 'customer_message',
        surface: 'widget',
      })
    )
    const replacement = await proposePendingAction({
      conversationId,
      toolName: 'issue_refund',
      args: { orderId: 'B2' },
      summary: 'Issue refund for B2',
      runId: secondRun.run.id,
      argsDigest: digestOf({ orderId: 'B2' }),
    })

    expect(await getPendingActionById(original.id)).toMatchObject({
      status: 'expired',
      disposition: 'superseded:changed_request',
    })
    expect((await getPendingActionById(replacement.id))?.status).toBe('proposed')
  })

  it('a late result after takeover becomes private context, never a customer message', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)
    await db
      .update(assistantPendingActions)
      .set({ status: 'approved', decidedById: reviewerId, executionState: 'succeeded' })
      .where(eq(assistantPendingActions.id, action.id))
    // The takeover: a teammate now owns the conversation.
    await db
      .update(conversations)
      .set({ assignedAgentPrincipalId: reviewerId })
      .where(eq(conversations.id, conversationId))
    const approved = (await getPendingActionById(action.id))!

    const routed = await ownershipForActionResult(approved, {
      kind: 'succeeded',
      note: 'Refund issued',
    })

    expect(routed.kind).toBe('private_note')
    const messages = await db
      .select({
        isInternal: conversationMessages.isInternal,
        content: conversationMessages.content,
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
    // Two internal notes: the one that announced the proposal, and the result
    // this case is about. Nothing customer-visible at all.
    expect(
      messages.every((m) => m.isInternal),
      'the customer must not be told by Quinn'
    ).toBe(true)
    expect(messages.map((m) => m.content).join(' ')).toContain('Refund issued')
    // And no continuation turn was scheduled, so nothing can publish later.
    const runs = await db
      .select({ id: assistantRuns.id })
      .from(assistantRuns)
      .where(eq(assistantRuns.conversationId, conversationId))
    expect(runs).toHaveLength(0)
  })

  it('an unconfirmed result is reported as unconfirmed, with no repeat offered', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)
    await db
      .update(assistantPendingActions)
      .set({ status: 'approved', decidedById: reviewerId, executionState: 'unknown' })
      .where(eq(assistantPendingActions.id, action.id))
    const approved = (await getPendingActionById(action.id))!

    const routed = await ownershipForActionResult(approved, {
      kind: 'unknown',
      note: 'not confirmed',
    })

    expect(routed.kind).toBe('continuation')
    const [job] = getExecuteRows<{ payload: { stepInstructions?: string } }>(
      await db.execute(sql`
        SELECT payload FROM job_queue
        WHERE queue = 'assistant-turn' AND payload->>'conversationId' = ${conversationId}
      `)
    )
    const instructions = job?.payload?.stepInstructions ?? ''
    expect(instructions).toContain('did not confirm')
    expect(instructions.toLowerCase()).not.toContain('try it again.')
  })
})

describe.skipIf(!available)('approval integrity', () => {
  it('argument drift after the approval requires a new decision', async () => {
    const conversationId = await newConversation()
    // A REAL catalogue tool, so the resolver walks its real lookup path and
    // the digest comparison is what decides, not a stand-in.
    const action = await proposePendingAction({
      conversationId,
      toolName: 'end_conversation',
      args: { reason: 'resolved' },
      summary: 'Close the conversation',
      argsDigest: digestOf({ reason: 'resolved' }),
      requestedById: visitorId,
    })
    await db
      .update(assistantPendingActions)
      .set({
        status: 'approved',
        decidedById: reviewerId,
        decidedAt: new Date(),
        // What the reviewer actually saw.
        approvedArgsDigest: digestOf({ reason: 'resolved' }),
        // What somebody rewrote the row to afterwards.
        args: { reason: 'customer never replied' },
      })
      .where(eq(assistantPendingActions.id, action.id))

    const resolved = await resolveApprovedAction((await getPendingActionById(action.id))!)

    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.refusal).toBe('arguments_changed')
    expect(await receiptsFor(conversationId)).toHaveLength(0)
  })

  it('lets the same approved operation through when nothing drifted', async () => {
    const conversationId = await newConversation()
    const action = await proposePendingAction({
      conversationId,
      toolName: 'end_conversation',
      args: { reason: 'resolved' },
      summary: 'Close the conversation',
      argsDigest: digestOf({ reason: 'resolved' }),
      requestedById: visitorId,
    })
    await db
      .update(assistantPendingActions)
      .set({
        status: 'approved',
        decidedById: reviewerId,
        decidedAt: new Date(),
        approvedArgsDigest: digestOf({ reason: 'resolved' }),
      })
      .where(eq(assistantPendingActions.id, action.id))

    const resolved = await resolveApprovedAction((await getPendingActionById(action.id))!)

    // This is the control for the case above: without it, a resolver that
    // refused everything would pass the drift test for the wrong reason.
    expect(resolved.ok, JSON.stringify(resolved)).toBe(true)
  })

  it('keeps the requester and the approver as two different people on the record', async () => {
    const conversationId = await newConversation()
    const action = await proposal(conversationId)
    await decideAndEnqueuePendingAction({
      id: action.id,
      decision: 'approved',
      decidedById: reviewerId,
    })
    const stored = await getPendingActionById(action.id)
    expect(stored?.requestedById).toBe(visitorId)
    expect(stored?.decidedById).toBe(reviewerId)
  })
})

describe.skipIf(!available)('receipt settlement', () => {
  it('settles a success with its bounded result, so a replay can answer from it', async () => {
    const conversationId = await newConversation()
    const claimed = await claimToolCall({
      conversationId,
      toolName: 'issue_refund',
      args: { orderId: 'A7' },
      actionKey: `${conversationId}:settle:issue_refund`,
    })
    await settleToolCall(claimed!.id, {
      status: 'succeeded',
      value: { refundId: 'r_7' },
      receiptId: claimed!.id,
    })
    const [row] = await db
      .select()
      .from(assistantToolCalls)
      .where(and(eq(assistantToolCalls.id, claimed!.id)))
    expect(row).toMatchObject({ status: 'succeeded', outcomeStatus: 'succeeded' })
    expect(row.result).toEqual({ refundId: 'r_7' })
    expect(row.settledAt).not.toBeNull()
  })
})
