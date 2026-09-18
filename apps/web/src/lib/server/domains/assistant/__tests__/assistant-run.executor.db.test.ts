/**
 * The whole durable turn, end to end, against a real database and the real
 * queue lease: claim, freeze the behaviour, generate, publish, settle.
 *
 * The model is the only fake, and it is a fake with a barrier rather than a
 * stub that returns instantly: a turn that cannot be paused mid-generation
 * cannot demonstrate anything about what happens when a human takes over while
 * it is thinking. The lease, the claim, the transactions and every fence are
 * the production ones.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

process.env.BASE_URL = 'http://localhost:4319'
process.env.SECRET_KEY = 'assistant-run-executor-secret-at-least-32-characters'

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
vi.mock('@/lib/server/domains/settings/settings.widget', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.widget')>()),
  getMessengerConfig: vi.fn(async () => ({ assistant: { respond: true } })),
}))
// The fake model. `runAssistantTurn` is re-exported through the domain barrel
// the orchestrator imports, so replacing it here replaces it for the real code
// path under test.
vi.mock('../assistant.runtime', async (original) => {
  const actual = await original<typeof import('../assistant.runtime')>()
  return {
    ...actual,
    isAssistantConfigured: () => true,
    runAssistantTurn: vi.fn(),
  }
})

import {
  db,
  conversations,
  conversationMessages,
  assistantRuns,
  principal,
  and,
  eq,
  sql,
} from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { claimById, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { runAssistantTurn } from '../assistant.runtime'
import {
  requestAssistantTurn,
  customerMessageTriggerKey,
  invalidateAssistantWork,
  ASSISTANT_TURN_QUEUE,
} from '../assistant-run.service'
import { advanceAssistantRun } from '../assistant-run.executor'

const dedicatedDatabase = !!process.env.TEST_DATABASE_URL?.includes('quinn_runs')
const tableAvailable = dedicatedDatabase
  ? await db.execute(sql`SELECT to_regclass('public.assistant_runs') AS t`).then(
      (result) => !!getExecuteRows<{ t: string | null }>(result)[0]?.t,
      () => false
    )
  : false
const available = dedicatedDatabase && tableAvailable

let visitorId: PrincipalId
const SUBJECT = 'durable executor fixture'

function answer(text: string) {
  return {
    status: 'answered' as const,
    responseKind: 'answer' as const,
    text,
    answerType: 'draft_reply' as const,
    citations: [],
    internalSourced: false,
    proposedActions: [],
    identity: { name: 'Quinn', avatarUrl: null },
    trace: {
      promptVersion: 'test',
      configRevision: 1,
      role: 'customer_support',
      appliedGuidance: [],
      toolCalls: [],
    },
  }
}

async function seedTurn(): Promise<{ conversationId: ConversationId; runId: string }> {
  const [conversation] = await db
    .insert(conversations)
    .values({
      visitorPrincipalId: visitorId,
      channel: 'messenger',
      source: 'widget',
      status: 'open',
      subject: SUBJECT,
    })
    .returning()
  return db.transaction(async (tx) => {
    const [message] = await tx
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        principalId: visitorId,
        senderType: 'visitor',
        content: 'where is my order?',
      })
      .returning()
    const requested = await requestAssistantTurn(tx, {
      conversationId: conversation.id,
      triggerKey: customerMessageTriggerKey(conversation.id, message.id),
      triggerKind: 'customer_message',
      surface: 'widget',
      triggerMessageId: message.id,
      requestedByPrincipalId: visitorId,
    })
    return { conversationId: conversation.id, runId: requested.run.id }
  })
}

async function claimTurnJob(runId: string): Promise<ClaimedJob> {
  const [row] = getExecuteRows<{ job_id: string }>(
    await db.execute(sql`
      SELECT job_id FROM job_queue
      WHERE queue = ${ASSISTANT_TURN_QUEUE} AND dedupe_key = ${`assistant-turn:${runId}`}
    `)
  )
  const job = await claimById(row.job_id, 60_000)
  expect(job).toBeTruthy()
  return job!
}

async function publicReplies(conversationId: ConversationId) {
  return db
    .select({ id: conversationMessages.id, content: conversationMessages.content })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.senderType, 'agent'),
        eq(conversationMessages.isInternal, false)
      )
    )
}

describe.skipIf(!available)('the durable turn executor on real PostgreSQL', () => {
  beforeAll(async () => {
    await db.execute(sql`DELETE FROM job_queue WHERE queue = ${ASSISTANT_TURN_QUEUE}`)
    await db.delete(conversations).where(eq(conversations.subject, SUBJECT))
    const [visitor] = await db
      .insert(principal)
      .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
      .returning()
    visitorId = visitor.id
    const [existing] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(
        and(
          eq(principal.type, 'service'),
          sql`${principal.serviceMetadata}->>'integrationType' = 'assistant'`
        )
      )
      .limit(1)
    if (!existing) {
      await db.insert(principal).values({
        role: 'member',
        type: 'service',
        displayName: 'Quinn',
        serviceMetadata: { kind: 'integration', integrationType: 'assistant' },
        createdAt: new Date(),
      })
    }
  })

  afterEach(async () => {
    await db.execute(sql`DELETE FROM job_queue WHERE queue = ${ASSISTANT_TURN_QUEUE}`)
    vi.mocked(runAssistantTurn).mockReset()
  })

  afterAll(async () => {
    await db.delete(conversations).where(eq(conversations.subject, SUBJECT))
    if (visitorId) await db.delete(principal).where(eq(principal.id, visitorId))
  })

  it('claims, freezes the behaviour, publishes once and settles the run', async () => {
    const { conversationId, runId } = await seedTurn()
    vi.mocked(runAssistantTurn).mockResolvedValue(
      answer('Your order is on its way.') as unknown as Awaited<ReturnType<typeof runAssistantTurn>>
    )

    const job = await claimTurnJob(runId)
    expect(await advanceAssistantRun(job)).toBe('published')

    const replies = await publicReplies(conversationId)
    expect(replies).toHaveLength(1)
    expect(replies[0].content).toBe('Your order is on its way.')

    const [run] = await db
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.id, runId as never))
    expect(run.status).toBe('succeeded')
    expect(run.outcome).toBe('answer')
    expect(run.resultMessageId).toBe(replies[0].id)
    // The behaviour the run executed under is recorded, not inferred later.
    expect(run.snapshotId).not.toBeNull()
    expect(run.jobLeaseToken).toBe(job.leaseToken)
  })

  it('publishes nothing when a teammate takes over mid-generation', async () => {
    const { conversationId, runId } = await seedTurn()

    // The barrier: the fake model blocks until the takeover has committed, so
    // the interleaving under test is the real one rather than a lucky ordering.
    let releaseModel: () => void = () => {}
    const modelBlocked = new Promise<void>((resolve) => {
      releaseModel = resolve
    })
    let generationStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      generationStarted = resolve
    })
    vi.mocked(runAssistantTurn).mockImplementation(async () => {
      generationStarted()
      await modelBlocked
      return answer('Here is the answer nobody should see.') as unknown as Awaited<
        ReturnType<typeof runAssistantTurn>
      >
    })

    const job = await claimTurnJob(runId)
    const turn = advanceAssistantRun(job)
    await started
    await invalidateAssistantWork(db, conversationId, 'human_reply')
    releaseModel()

    expect(await turn).toBe('fence:input_revision')
    expect(await publicReplies(conversationId)).toHaveLength(0)
    const [run] = await db
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.id, runId as never))
    expect(run.status).toBe('superseded')
    expect(run.disposition).toBe('fence:input_revision')
    expect(run.resultMessageId).toBeNull()
  })

  it('records a suppressed run when the engine declines to speak', async () => {
    const { conversationId, runId } = await seedTurn()
    vi.mocked(runAssistantTurn).mockResolvedValue({
      status: 'suppressed',
      reason: 'silence',
    } as unknown as Awaited<ReturnType<typeof runAssistantTurn>>)

    const job = await claimTurnJob(runId)
    expect(await advanceAssistantRun(job)).toBe('suppressed')
    expect(await publicReplies(conversationId)).toHaveLength(0)
    const [run] = await db
      .select()
      .from(assistantRuns)
      .where(eq(assistantRuns.id, runId as never))
    expect(run.status).toBe('suppressed')
    expect(run.outcome).toBeNull()
  })
})
