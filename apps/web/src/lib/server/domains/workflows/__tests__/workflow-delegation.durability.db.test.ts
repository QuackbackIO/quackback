/**
 * Durable workflow delegation, on committed rows and independent connections.
 *
 * The properties here are about what another process can see, so they cannot be
 * shown inside a rolled-back transaction: a worker claiming the turn job lives
 * on its own connection, and the whole question is whether it can ever see a
 * turn to run before the wait that turn answers exists. A second connection,
 * opened for this file, is the observer.
 *
 * Nothing that participates in the claim is mocked. The doubles are the
 * orchestrator's eligibility read, realtime fan-out and notifications, none of
 * which take part in a transaction.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

process.env.BASE_URL = 'http://localhost:4319'
process.env.SECRET_KEY = 'workflow-delegation-durability-secret-at-least-32-chars'

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
  notifyCsatRequestEmail: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => ({ enabled: false, timezone: 'UTC', intervals: [] })),
}))
// This database carries no workspace settings row, and the abandoned-journey
// setting is not what any of these cases are about.
vi.mock('@/lib/server/domains/settings/settings.workflows', () => ({
  getWorkflowAbandonedAutoCloseSettings: vi.fn(async () => ({
    enabled: false,
    waitMinutes: 5,
    keepIfEmailCaptured: true,
  })),
}))

const { previewAssistantTurnForConversation, runAssistantTurnForConversation } = vi.hoisted(() => ({
  previewAssistantTurnForConversation: vi.fn(async () => 'eligible' as const),
  runAssistantTurnForConversation: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/assistant/assistant.orchestrator')
  >()),
  previewAssistantTurnForConversation,
  runAssistantTurnForConversation,
}))

/** A hook inside the park transaction, between the wait and the turn job. */
let beforeEnqueue: (() => Promise<void>) | null = null
vi.mock('@/lib/server/jobs/job-queue', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/server/jobs/job-queue')>()
  return {
    ...mod,
    enqueueJob: vi.fn(async (input: Parameters<typeof mod.enqueueJob>[0]) => {
      if (beforeEnqueue) await beforeEnqueue()
      return mod.enqueueJob(input)
    }),
  }
})

// oxlint-disable-next-line no-restricted-imports
import { createDb, type Database } from '@quackback/db/client'
import {
  db,
  and,
  eq,
  sql,
  assistantPendingActions,
  assistantRuns,
  conversations,
  events,
  principal,
  workflowRuns,
  workflows,
} from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { AssistantRunId, ConversationId, PrincipalId, WorkflowId } from '@quackback/ids'
import { createWorkflow, setWorkflowStatus } from '../workflow.service'
import { runWorkflow } from '../workflow.engine'
import { readCursor } from '../workflow-wait-queue'
import { sweepExpiredAssistantWaits } from '../workflow-sweep'
import { makeConditionContext } from './workflow-test-utils'
import { parkRunForAction } from '@/lib/server/domains/assistant/assistant-run.service'
import {
  proposePendingAction,
  sweepAndNotifyExpiredPendingActions,
} from '@/lib/server/domains/assistant/pending-actions.service'
import { digestOf } from '@/lib/server/domains/assistant/tool-receipts'

/**
 * Opt in on a database of its own, `quackback_quinn_s6`.
 *
 * This suite commits on purpose, and the observer connection below has to see
 * those commits. It does not share the other durability suites' databases: the
 * queue is FIFO per queue name and every one of these files writes
 * `assistant-turn` rows.
 */
const dedicated = !!process.env.TEST_DATABASE_URL?.includes('quinn_s6')
const tableAvailable = dedicated
  ? await db.execute(sql`SELECT to_regclass('public.assistant_runs') AS t`).then(
      (result) => !!getExecuteRows<{ t: string | null }>(result)[0]?.t,
      () => false
    )
  : false
const available = dedicated && tableAvailable

const SUBJECT = 'workflow delegation fixture'
let observer: Database
let visitorId: PrincipalId
const createdConversations: ConversationId[] = []
const createdWorkflows: WorkflowId[] = []

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
  createdConversations.push(row.id)
  return row.id
}

async function newWorkflow() {
  const wf = await createWorkflow({
    name: `Let Quinn answer ${Math.random().toString(36).slice(2, 8)}`,
    class: 'customer_facing',
    triggerType: 'conversation.created',
    graph: {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'la', type: 'let_assistant_answer' },
        { id: 'a_escalated', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
      ],
      edges: [
        { from: 't', to: 'la' },
        { from: 'la', to: 'a_escalated', branch: 'escalated' },
      ],
    },
  })
  await setWorkflowStatus(wf.id, 'live')
  createdWorkflows.push(wf.id)
  return wf
}

const ctx = () =>
  makeConditionContext({
    conversation: {
      status: 'open',
      channel: 'messenger',
      priority: 'none',
      waitingMinutes: null,
      tagIds: [],
      assignedTeamId: null,
    },
  })

beforeAll(async () => {
  if (!available) return
  observer = createDb(process.env.TEST_DATABASE_URL!)
  const [visitor] = await db
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  visitorId = visitor.id
  await db.execute(sql`DELETE FROM job_queue WHERE queue = 'assistant-turn'`)
  await db.delete(conversations).where(eq(conversations.subject, SUBJECT))
})

afterEach(async () => {
  if (!available) return
  beforeEnqueue = null
  await db.execute(sql`DELETE FROM job_queue WHERE queue = 'assistant-turn'`)
})

afterAll(async () => {
  if (!available) return
  await db.execute(sql`DELETE FROM job_queue WHERE queue = 'assistant-turn'`)
  for (const id of createdConversations)
    await db.delete(conversations).where(eq(conversations.id, id))
  for (const id of createdWorkflows) await db.delete(workflows).where(eq(workflows.id, id))
  if (visitorId) await db.delete(principal).where(eq(principal.id, visitorId))
})

describe.skipIf(!available)('durable delegation across connections', () => {
  it('no worker can see a turn to run before the wait it answers exists', async () => {
    const conversationId = await newConversation()
    const wf = await newWorkflow()

    // Observed from a separate connection at the exact moment the park has
    // written the wait and is about to write the turn job. Before P4 the turn
    // was launched here, so a fast answer could hand off while the run was
    // still 'running' and the completion had nothing to resume.
    let midPark: { runs: number; jobs: number; state: string | undefined } | null = null
    beforeEnqueue = async () => {
      const runs = await observer
        .select({ id: assistantRuns.id })
        .from(assistantRuns)
        .where(eq(assistantRuns.conversationId, conversationId))
      const jobs = getExecuteRows(
        await observer.execute(
          sql`SELECT 1 FROM job_queue WHERE queue = 'assistant-turn' AND payload->>'conversationId' = ${conversationId}`
        )
      )
      const [row] = await observer
        .select({ state: workflowRuns.state })
        .from(workflowRuns)
        .where(eq(workflowRuns.conversationId, conversationId))
      midPark = { runs: runs.length, jobs: jobs.length, state: row?.state }
    }

    const run = await runWorkflow(wf, ctx(), { conversationId })
    expect(run?.state).toBe('waiting')

    // Mid-transaction, the outside world had no wait, no run and no job: the
    // three are indivisible.
    expect(midPark).not.toBeNull()
    expect(midPark!).toMatchObject({ runs: 0, jobs: 0 })
    expect(midPark!.state).not.toBe('waiting')

    // After the commit the job exists, and by then the wait it answers is
    // durable and correlated.
    const [parked] = await observer.select().from(workflowRuns).where(eq(workflowRuns.id, run!.id))
    expect(parked.state).toBe('waiting')
    const [delegated] = await observer
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.conversationId, conversationId))
    expect(delegated.delegation).toEqual({ workflowRunId: run!.id, nodeId: 'la', waitSeq: 1 })
    expect(readCursor(parked).delegatedRunId).toBe(delegated.id)
    const jobs = getExecuteRows<{ payload: Record<string, unknown> }>(
      await observer.execute(
        sql`SELECT payload FROM job_queue WHERE queue = 'assistant-turn' AND payload->>'conversationId' = ${conversationId}`
      )
    )
    expect(jobs).toHaveLength(1)
    expect(jobs[0].payload.runId).toBe(delegated.id)
  })

  it('an approval does not emit a handoff, and the wait keeps waiting', async () => {
    const conversationId = await newConversation()
    const wf = await newWorkflow()
    const run = await runWorkflow(wf, ctx(), { conversationId })
    const [delegated] = await db
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.conversationId, conversationId))

    // The turn published an acknowledgement and parked on a proposal.
    const proposal = await proposePendingAction({
      conversationId,
      toolName: 'issue_refund',
      args: { orderId: 'A1' },
      summary: 'Issue refund for A1',
      argsDigest: digestOf({ orderId: 'A1' }),
      requestedById: visitorId,
      runId: delegated.id as AssistantRunId,
    })
    await parkRunForAction(db, delegated.id as AssistantRunId, proposal.id)

    // A review is not an escalation: no handoff outcome is emitted for it.
    const handoffs = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.entityId, conversationId), eq(events.type, 'assistant.handed_off')))
    expect(handoffs).toHaveLength(0)

    // And the wait is still exactly where it was, at the same visit.
    const [stillParked] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, run!.id))
    expect(stillParked.state).toBe('waiting')
    expect(readCursor(stillParked).waitSeq).toBe(1)

    // Even past its own deadline: Quinn owes a result, so the wait defers
    // rather than escalating behind the reviewer's back.
    const cursor = readCursor(stillParked)
    await db
      .update(workflowRuns)
      .set({ cursor: { ...cursor, expiresAt: new Date(Date.now() - 60_000).toISOString() } })
      .where(eq(workflowRuns.id, run!.id))
    expect(await sweepExpiredAssistantWaits(new Date())).toBe(0)
    const [afterSweep] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, run!.id))
    expect(afterSweep.state).toBe('waiting')
  })

  it('a proposal nobody decided releases the run parked on it', async () => {
    const conversationId = await newConversation()
    const [delegated] = await db
      .insert(assistantRuns)
      .values({
        conversationId,
        surface: 'widget',
        triggerKind: 'customer_message',
        triggerKey: `conversation:${conversationId}:message:ack`,
        status: 'running',
      })
      .returning()
    const proposal = await proposePendingAction({
      conversationId,
      toolName: 'issue_refund',
      args: { orderId: 'A2' },
      summary: 'Issue refund for A2',
      argsDigest: digestOf({ orderId: 'A2' }),
      requestedById: visitorId,
      runId: delegated.id as AssistantRunId,
    })
    await parkRunForAction(db, delegated.id as AssistantRunId, proposal.id)
    await db
      .update(assistantPendingActions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(assistantPendingActions.id, proposal.id))

    await sweepAndNotifyExpiredPendingActions()

    // The wait Quinn owed is over, so the lifecycle clock may run again.
    const [released] = await db
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.id, delegated.id))
    expect(released.status).toBe('cancelled')
    expect(released.disposition).toBe(`action:expired:${proposal.id}`)
  })
})
