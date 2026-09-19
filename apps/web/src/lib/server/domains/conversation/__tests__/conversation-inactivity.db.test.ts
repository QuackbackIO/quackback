import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest'
import { type ConversationId, type PrincipalId } from '@quackback/ids'
process.env.BASE_URL = 'http://localhost:4319'
process.env.SECRET_KEY ??= 'lifecycle-test-secret-with-at-least-32-characters'
vi.mock('@/lib/server/realtime/presence', () => ({ isPrincipalOnline: vi.fn(async () => true) }))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationUpdate: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
}))
vi.mock('../conversation.notify', () => ({
  notifyAgentReply: vi.fn(async () => {}),
  notifyVisitorMessage: vi.fn(),
}))
vi.mock('@/lib/server/domains/changelog/changelog-subscription.service', () => ({
  ensureAutoSubscribed: vi.fn(async () => {}),
}))
vi.mock('../conversation.query', async (original) => ({
  ...(await original<typeof import('../conversation.query')>()),
  conversationToDTO: vi.fn(async (row: { id: string }) => ({ id: row.id })),
}))
vi.mock('@/lib/server/jobs/job-queue', async (original) => {
  const mod = await original<typeof import('@/lib/server/jobs/job-queue')>()
  return { ...mod, enqueueJob: vi.fn(mod.enqueueJob) }
})
import {
  db,
  conversations,
  conversationMessages,
  principal,
  user,
  settings,
  assistantInvolvements,
  assistantRuns,
  workflows,
  workflowRuns,
  eq,
  inArray,
  sql,
} from '@/lib/server/db'
import { enqueueJob, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { DEFAULT_CONVERSATION_INACTIVITY as defaults } from '@/lib/shared/conversation-inactivity'
import {
  updateConversationInactivitySettings,
  getConversationInactivitySettings,
} from '@/lib/server/domains/settings/settings.conversation-inactivity'
import { writeMetadataKey } from '@/lib/server/domains/settings/settings.helpers'
import {
  sweepInactivity,
  nextInactivityDeadline,
  deliverInactivity,
  continueInactivity,
} from '../conversation.inactivity'
import { recordVisitorContact } from '../conversation.contact'
import { appendAssistantReply, endConversation, sendVisitorMessage } from '../conversation.service'
import { notifyAgentReply } from '../conversation.notify'
import { isPrincipalOnline } from '@/lib/server/realtime/presence'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'

const enabled = !!process.env.TEST_DATABASE_URL?.includes('lifecycle')
const minute = 60_000,
  hour = 60 * minute
let visitor: PrincipalId, agent: PrincipalId, assistant: PrincipalId
let workspace: typeof settings.$inferSelect
let ids: ConversationId[] = []
let workflowIds: Array<typeof workflows.$inferSelect.id> = []
const now = () => new Date()
async function row(id: ConversationId) {
  return (await db.select().from(conversations).where(eq(conversations.id, id)))[0]!
}
async function configure(patch: Record<string, unknown>) {
  await db
    .update(settings)
    .set({
      metadata: JSON.stringify({
        sentinel: 'keep',
        conversationInactivity: { ...structuredClone(defaults), ...patch },
      }),
    })
    .where(eq(settings.id, workspace.id))
}
async function conversation(
  channel: 'messenger' | 'email' | 'github' = 'messenger',
  owner: 'team' | 'assistant_answered' | 'assistant_waiting' | 'handoff' = 'team',
  age = 16 * minute
) {
  const [c] = await db
    .insert(conversations)
    .values({
      visitorPrincipalId: visitor,
      channel,
      subject: 'Lifecycle regression',
      visitorEmail: 'visitor@example.test',
      inactivityOwner: owner,
      inactivityAnchorAt: new Date(Date.now() - age),
    })
    .returning()
  ids.push(c.id)
  return c
}
async function message(
  id: ConversationId,
  sender: 'agent' | 'visitor',
  author = agent,
  metadata?: typeof conversationMessages.$inferInsert.metadata,
  at = now()
) {
  return db.insert(conversationMessages).values({
    conversationId: id,
    principalId: author,
    senderType: sender,
    content: 'Lifecycle regression message',
    metadata,
    createdAt: at,
  })
}
async function jobs(queue = 'conversation-inactivity-delivery') {
  return getExecuteRows<{ payload: Record<string, unknown> }>(
    await db.execute(sql`SELECT payload FROM job_queue WHERE queue = ${queue} ORDER BY id`)
  )
}

describe.skipIf(!enabled)('durable conversation inactivity on migrated PostgreSQL', () => {
  it('initializes only affected channels for existing live inactivity workflows, once', async () => {
    const [w] = await db
      .insert(workflows)
      .values({
        name: 'Existing custom inactivity',
        class: 'background',
        status: 'live',
        triggerType: 'conversation.customer_unresponsive',
        triggerSettings: {
          channels: ['email'],
          audience: { field: 'conversation.priority', op: 'eq', value: 'high' },
        },
        graph: { nodes: [], edges: [] },
      })
      .returning()
    workflowIds.push(w.id)
    const migration = readFileSync(
      resolve(
        __dirname,
        '../../../../../../../../packages/db/drizzle/0284_conversation_inactivity.sql'
      ),
      'utf8'
    )
    const ownership = migration.slice(
      migration.indexOf('UPDATE settings s'),
      migration.indexOf('--> statement-breakpoint', migration.indexOf('UPDATE settings s'))
    )
    await db
      .update(settings)
      .set({
        metadata: JSON.stringify({
          keep: 1,
          conversationInactivity: {
            messenger: { enabled: false, checkInMinutes: 17, closeMinutes: 35 },
          },
        }),
      })
      .where(eq(settings.id, workspace.id))
    await db.execute(sql.raw(ownership))
    let current = await getConversationInactivitySettings()
    expect(current.channels).toEqual({ messenger: 'built_in', email: 'custom' })
    expect(current.messenger).toMatchObject({
      enabled: false,
      checkInMinutes: 17,
      closeMinutes: 35,
    })
    await db.update(workflows).set({ triggerSettings: {} }).where(eq(workflows.id, w.id))
    await db.execute(sql.raw(ownership))
    expect((await getConversationInactivitySettings()).channels).toEqual(current.channels)
    await db.update(settings).set({ metadata: '{}' }).where(eq(settings.id, workspace.id))
    await db.execute(sql.raw(ownership))
    expect((await getConversationInactivitySettings()).channels).toEqual({
      messenger: 'custom',
      email: 'custom',
    })
  })
  it('backfills real human authors and distinguishes later clarifications from historical answers', async () => {
    const human = await conversation(),
      customer = await conversation(),
      clarification = await conversation()
    const earlier = new Date(Date.now() - 2 * hour)
    await message(human.id, 'agent', agent, undefined, earlier)
    await message(customer.id, 'visitor', visitor, undefined, earlier)
    await message(
      clarification.id,
      'agent',
      assistant,
      { assistantResponseKind: 'clarification' },
      new Date(Date.now() - hour)
    )
    await db.insert(assistantInvolvements).values({
      conversationId: clarification.id,
      triggeredBy: 'first_touch',
      lastAssistantAnswerAt: earlier,
    })
    await db
      .update(conversations)
      .set({ inactivityOwner: null, inactivityAnchorAt: null })
      .where(inArray(conversations.id, [human.id, customer.id, clarification.id]))
    const migration = readFileSync(
      resolve(
        __dirname,
        '../../../../../../../../packages/db/drizzle/0284_conversation_inactivity.sql'
      ),
      'utf8'
    )
    await db.execute(sql.raw(migration.slice(migration.indexOf('WITH last_reply'))))
    expect((await row(human.id)).inactivityOwner).toBe('team')
    expect((await row(customer.id)).inactivityOwner).toBeNull()
    expect((await row(clarification.id)).inactivityOwner).toBe('assistant_waiting')
  })
  it('keeps an explicit Quinn closure closed after its final response is persisted', async () => {
    const c = await conversation('messenger', 'assistant_answered')
    await appendAssistantReply(
      c.id,
      'Glad that helped.',
      { principalId: assistant },
      { waiting: false, metadata: { assistantResponseKind: 'answer' } }
    )
    await endConversation(c.id, 'resolved', 'Customer confirmed resolution', {
      principalId: assistant,
      principalType: 'service',
      role: 'member',
      segmentIds: new Set(),
    })
    expect((await row(c.id)).status).toBe('closed')
    const transcript = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, c.id))
    expect(transcript.some((m) => m.content === 'Glad that helped.')).toBe(true)
  })
  it.each(['off', 'optional', 'required', 'outside_office_hours'] as const)(
    'enforces %s capture at the first-message boundary',
    async (mode) => {
      await db
        .update(settings)
        .set({
          widgetConfig: JSON.stringify({ messenger: { contactCapture: { mode, askName: true } } }),
          metadata: JSON.stringify({
            officeHours: { enabled: true, timezone: 'Europe/London', intervals: [] },
          }),
        })
        .where(eq(settings.id, workspace.id))
      const send = (email?: string) =>
        sendVisitorMessage(
          { content: 'A real first message', visitorEmail: email },
          { principalId: visitor },
          { principalId: visitor, principalType: 'anonymous', role: 'user', segmentIds: new Set() }
        )
      if (mode === 'required' || mode === 'outside_office_hours')
        await expect(send()).rejects.toThrow('valid email')
      const result = await send(
        mode === 'off' || mode === 'optional' ? undefined : 'valid@example.test'
      )
      ids.push(result.conversation.id)
      expect((await row(result.conversation.id)).status).toBe('open')
    }
  )
  it('bypasses required capture for known email, identified contacts, and a 24/7 outside-hours schedule', async () => {
    await db
      .update(settings)
      .set({
        widgetConfig: JSON.stringify({ messenger: { contactCapture: { mode: 'required' } } }),
      })
      .where(eq(settings.id, workspace.id))
    const send = () =>
      sendVisitorMessage(
        { content: 'Known visitor' },
        { principalId: visitor },
        { principalId: visitor, principalType: 'anonymous', role: 'user', segmentIds: new Set() }
      )
    await db
      .update(principal)
      .set({ contactEmail: 'known@example.test' })
      .where(eq(principal.id, visitor))
    ids.push((await send()).conversation.id)
    await db
      .update(principal)
      .set({ contactEmail: null, type: 'user' })
      .where(eq(principal.id, visitor))
    ids.push((await send()).conversation.id)
    await db.update(principal).set({ type: 'anonymous' }).where(eq(principal.id, visitor))
    await db
      .update(settings)
      .set({
        widgetConfig: JSON.stringify({
          messenger: { contactCapture: { mode: 'outside_office_hours' } },
        }),
        metadata: JSON.stringify({
          officeHours: { enabled: false, timezone: 'Europe/London', intervals: [] },
        }),
      })
      .where(eq(settings.id, workspace.id))
    ids.push((await send()).conversation.id)
  })

  beforeAll(async () => {
    workspace = (await db.select().from(settings).limit(1))[0]!
    const [u] = await db.insert(user).values({ name: 'Lifecycle agent' }).returning()
    const principals = await db
      .insert(principal)
      .values([
        { type: 'anonymous', role: 'user', displayName: 'Lifecycle visitor', createdAt: now() },
        {
          type: 'user',
          role: 'admin',
          userId: u.id,
          displayName: 'Lifecycle agent',
          createdAt: now(),
        },
        {
          type: 'service',
          role: 'member',
          displayName: 'Quinn',
          serviceMetadata: { kind: 'integration', integrationType: 'assistant' },
          createdAt: now(),
        },
      ])
      .returning()
    ;[visitor, agent, assistant] = principals.map((p) => p.id)
  })
  beforeEach(async () => {
    vi.clearAllMocks()
    await configure({})
    await db
      .update(principal)
      .set({ type: 'anonymous', contactEmail: null })
      .where(eq(principal.id, visitor))
    await db.execute(sql`DELETE FROM job_queue WHERE queue LIKE 'conversation-inactivity-%'`)
  })
  afterEach(async () => {
    if (ids.length) await db.delete(conversations).where(inArray(conversations.id, ids))
    ids = []
    if (workflowIds.length) await db.delete(workflows).where(inArray(workflows.id, workflowIds))
    workflowIds = []
    await db
      .update(settings)
      .set({ metadata: workspace.metadata, widgetConfig: workspace.widgetConfig })
      .where(eq(settings.id, workspace.id))
  })
  afterAll(async () => {
    if (visitor)
      await db.delete(principal).where(inArray(principal.id, [visitor, agent, assistant]))
  })

  it('starts only after a public human reply; notes and system notices do not reset it', async () => {
    const c = await conversation()
    const at = new Date(Date.now() - 10 * minute)
    await message(c.id, 'agent', agent, undefined, at)
    expect((await row(c.id)).inactivityAnchorAt).toEqual(at)
    await db.insert(conversationMessages).values([
      { conversationId: c.id, senderType: 'system', content: 'Notice' },
      {
        conversationId: c.id,
        senderType: 'agent',
        principalId: agent,
        content: 'Note',
        isInternal: true,
      },
    ])
    expect((await row(c.id)).inactivityAnchorAt).toEqual(at)
    await message(c.id, 'visitor', visitor)
    expect((await row(c.id)).inactivityAnchorAt).toBeNull()
  })
  it('sends a single follow-up with auto-close off and preserves the activity anchor', async () => {
    await configure({ messenger: { ...defaults.messenger, closeEnabled: false } })
    const c = await conversation()
    await Promise.all([sweepInactivity(), sweepInactivity()])
    expect((await jobs()).length).toBe(1)
    expect((await row(c.id)).inactivityAnchorAt).toEqual(c.inactivityAnchorAt)
    await sweepInactivity({ now: new Date(Date.now() + hour) })
    expect((await jobs()).length).toBe(1)
    expect((await row(c.id)).status).toBe('open')
    await message(c.id, 'agent', agent, undefined, new Date(Date.now() - 16 * minute))
    await sweepInactivity()
    expect((await jobs()).length).toBe(2)
  })
  it('closes Quinn and records assumed resolution in the same commit, retaining its owner', async () => {
    const c = await conversation('messenger', 'assistant_answered', 16 * minute)
    const [a] = await db
      .insert(assistantInvolvements)
      .values({
        conversationId: c.id,
        triggeredBy: 'first_touch',
        lastAssistantAnswerAt: c.inactivityAnchorAt,
      })
      .returning()
    await sweepInactivity()
    expect((await row(c.id)).status).toBe('closed')
    expect((await row(c.id)).inactivityOwner).toBe('assistant_answered')
    expect(
      (await db.select().from(assistantInvolvements).where(eq(assistantInvolvements.id, a.id)))[0]
        .status
    ).toBe('resolved_assumed')
  })
  it('rolls back closure and outcome when durable enqueue fails, and retries successfully', async () => {
    const c = await conversation('messenger', 'assistant_answered', 16 * minute)
    const [a] = await db
      .insert(assistantInvolvements)
      .values({ conversationId: c.id, triggeredBy: 'first_touch' })
      .returning()
    vi.mocked(enqueueJob).mockRejectedValueOnce(new Error('temporary queue failure'))
    await sweepInactivity()
    expect((await row(c.id)).status).toBe('open')
    expect(
      (await db.select().from(assistantInvolvements).where(eq(assistantInvolvements.id, a.id)))[0]
        .status
    ).toBe('active')
    await sweepInactivity()
    expect((await row(c.id)).status).toBe('closed')
  })
  it('does not treat a long clarification as an answer and honors the unanswered closure choice', async () => {
    const c = await conversation()
    await message(
      c.id,
      'agent',
      assistant,
      { assistantResponseKind: 'clarification' },
      new Date(Date.now() - 20 * minute)
    )
    expect((await row(c.id)).inactivityOwner).toBe('assistant_waiting')
    await configure({ assistant: { ...defaults.assistant, closeWhenUnanswered: false } })
    await sweepInactivity()
    expect((await row(c.id)).status).toBe('open')
    expect(await nextInactivityDeadline()).toBeNull()
  })
  it('hands off until a public human reply starts the team period', async () => {
    const c = await conversation()
    await message(
      c.id,
      'agent',
      assistant,
      { assistantResponseKind: 'handoff' },
      new Date(Date.now() - hour)
    )
    await sweepInactivity()
    expect((await row(c.id)).status).toBe('open')
    expect(await nextInactivityDeadline()).toBeNull()
    await message(c.id, 'agent', agent, undefined, new Date(Date.now() - 31 * minute))
    await sweepInactivity()
    expect((await row(c.id)).status).toBe('closed')
  })
  it('pauses snoozed conversations and starts a fresh period on wake', async () => {
    const c = await conversation('messenger', 'team', hour)
    await db
      .update(conversations)
      .set({ status: 'snoozed', snoozedUntil: new Date(Date.now() + hour) })
      .where(eq(conversations.id, c.id))
    await sweepInactivity()
    expect(await nextInactivityDeadline()).toBeNull()
    await db
      .update(conversations)
      .set({ status: 'open', snoozedUntil: null })
      .where(eq(conversations.id, c.id))
    expect((await row(c.id)).inactivityAnchorAt!.getTime()).toBeGreaterThan(Date.now() - 2000)
    await sweepInactivity()
    expect((await row(c.id)).status).toBe('open')
  })
  it.each(['custom', 'off'] as const)('gives %s ownership no built-in fallback', async (mode) => {
    await configure({ channels: { messenger: mode, email: 'built_in' } })
    const c = await conversation('messenger', 'team', hour)
    await sweepInactivity()
    expect((await row(c.id)).status).toBe('open')
    expect(await nextInactivityDeadline()).toBeNull()
  })
  it('protects interactive workflow waits and excludes native-close channels', async () => {
    const c = await conversation('messenger', 'team', hour)
    const native = await conversation('github', 'team', hour)
    const [w] = await db
      .insert(workflows)
      .values({ name: 'Input wait', class: 'customer_facing', triggerType: 'conversation.created' })
      .returning()
    workflowIds.push(w.id)
    await db.insert(workflowRuns).values({
      workflowId: w.id,
      conversationId: c.id,
      state: 'waiting',
      customerFacing: true,
      cursor: { waitKind: 'input' },
    })
    await sweepInactivity()
    expect((await row(c.id)).status).toBe('open')
    expect((await row(native.id)).status).toBe('open')
    expect(await nextInactivityDeadline()).toBeNull()
  })
  it('does not act while Quinn owes the result of an approved action', async () => {
    // The acknowledgement Quinn published for a proposal reads like an answer
    // to the trigger, so without this gate the close pass would record an
    // assumed resolution for a conversation whose real answer has not
    // happened yet (P4).
    const c = await conversation('messenger', 'assistant_answered', hour)
    const [parked] = await db
      .insert(assistantRuns)
      .values({
        conversationId: c.id,
        surface: 'widget',
        triggerKind: 'customer_message',
        triggerKey: `conversation:${c.id}:message:ack`,
        status: 'waiting_action',
      })
      .returning()
    await sweepInactivity()
    expect((await row(c.id)).status).toBe('open')
    expect(await nextInactivityDeadline()).toBeNull()

    // Once the result is settled the ordinary clock applies again: the gate
    // is bounded by the proposal, not open ended.
    await db
      .update(assistantRuns)
      .set({ status: 'succeeded' })
      .where(eq(assistantRuns.id, parked.id))
    await sweepInactivity()
    expect((await row(c.id)).status).toBe('closed')
  })
  it('does not race a customer reply holding the conversation lock', async () => {
    const c = await conversation('messenger', 'team', hour)
    await db.transaction(async (tx) => {
      await tx.select().from(conversations).where(eq(conversations.id, c.id)).for('update')
      await tx.insert(conversationMessages).values({
        conversationId: c.id,
        principalId: visitor,
        senderType: 'visitor',
        content: 'I am back',
      })
      await sweepInactivity()
    })
    expect((await row(c.id)).status).toBe('open')
    expect(await jobs()).toHaveLength(0)
  })
  it('uses independent email clocks and silent team email closure', async () => {
    const c = await conversation('email', 'team', 25 * hour)
    const ai = await conversation('email', 'assistant_answered', 25 * hour)
    await sweepInactivity()
    expect((await row(c.id)).inactivityCheckInAt).toBeNull()
    expect((await row(ai.id)).inactivityCheckInAt).not.toBeNull()
    await sweepInactivity({ now: new Date(Date.now() + 48 * hour) })
    const delivery = await jobs()
    expect(delivery.some((j) => j.payload.mail === false)).toBe(true)
  })
  it('retries failed email delivery without duplicating the transcript', async () => {
    await configure({ email: { ...defaults.email, checkInHours: 24, followUpEnabled: true } })
    const c = await conversation('email', 'team', 25 * hour)
    await sweepInactivity()
    const job = (await jobs())[0] as ClaimedJob
    vi.mocked(notifyAgentReply).mockRejectedValueOnce(new Error('provider down'))
    await expect(deliverInactivity(job)).rejects.toThrow('provider down')
    await deliverInactivity(job)
    await deliverInactivity(job)
    expect(notifyAgentReply).toHaveBeenCalledTimes(2)
    const messages = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, c.id))
    expect(messages).toHaveLength(1)
    expect(messages[0].metadata?.channelDelivery?.status).toBe('sent')
  })
  it('keeps team Messenger nudges online-only without preventing closure', async () => {
    vi.mocked(isPrincipalOnline).mockResolvedValueOnce(false)
    const c = await conversation()
    await sweepInactivity()
    expect((await row(c.id)).inactivityCheckInAt).toBeNull()
    await sweepInactivity({ now: new Date(Date.now() + 20 * minute) })
    expect((await row(c.id)).status).toBe('closed')
  })
  it('orders genuinely due candidates across more than 200 mixed-channel rows and continues', async () => {
    const input = Array.from({ length: 410 }, (_, i) => ({
      visitorPrincipalId: visitor,
      channel: i % 2 ? ('email' as const) : ('messenger' as const),
      subject: 'Lifecycle regression batch',
      inactivityOwner: 'team' as const,
      inactivityAnchorAt: new Date(Date.now() - 2 * hour),
    }))
    const created = await db.insert(conversations).values(input).returning()
    ids.push(...created.map((c) => c.id))
    expect((await sweepInactivity()).closed).toBe(200)
    const continuation = (await jobs('conversation-inactivity-continuation'))[0] as ClaimedJob
    await continueInactivity(continuation)
    const remaining = await db.select().from(conversations).where(inArray(conversations.id, ids))
    expect(remaining.filter((c) => c.status === 'closed')).toHaveLength(205)
    expect(remaining.filter((c) => c.channel === 'email').every((c) => c.status === 'open')).toBe(
      true
    )
  }, 60000)
  it('preserves custom copy verbatim and makes the default agree with reopening', async () => {
    await db
      .update(settings)
      .set({ widgetConfig: JSON.stringify({ messenger: { preventRepliesWhenClosed: true } }) })
      .where(eq(settings.id, workspace.id))
    const c = await conversation('messenger', 'team', hour)
    await sweepInactivity()
    expect(
      (
        await db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, c.id))
      )[0].content
    ).toContain('Start a new conversation')
    await configure({ messenger: { ...defaults.messenger, closingMessage: 'Custom farewell!' } })
    const other = await conversation('messenger', 'team', hour)
    await sweepInactivity()
    const m = (
      await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, other.id))
    )[0]
    expect(m.content).toBe('Custom farewell!')
    expect(m.metadata?.systemEvent?.customText).toBe(true)
  })
  it('rejects stale section revisions while preserving sibling metadata', async () => {
    const results = await Promise.allSettled([
      updateConversationInactivitySettings({
        section: 'email',
        revision: 0,
        policy: { closeHours: 48 },
      }),
      updateConversationInactivitySettings({
        section: 'messenger',
        revision: 0,
        policy: { closeMinutes: 45 },
      }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    await writeMetadataKey('anotherSetting', { enabled: true })
    expect((await getConversationInactivitySettings()).revision).toBe(1)
    const meta = JSON.parse(
      (await db.select().from(settings).where(eq(settings.id, workspace.id)))[0].metadata!
    )
    expect(meta.sentinel).toBe('keep')
    expect(meta.anotherSetting.enabled).toBe(true)
  })
  it('switching ownership interrupts only customer-inactivity runs', async () => {
    const c = await conversation()
    for (const triggerType of ['conversation.customer_unresponsive', 'conversation.created']) {
      const [w] = await db
        .insert(workflows)
        .values({ name: triggerType, class: 'background', triggerType })
        .returning()
      workflowIds.push(w.id)
      await db
        .insert(workflowRuns)
        .values({ workflowId: w.id, conversationId: c.id, state: 'waiting' })
    }
    await updateConversationInactivitySettings({
      section: 'messenger',
      revision: 0,
      policy: {},
      mode: 'custom',
    })
    const runs = await db.select().from(workflowRuns).where(eq(workflowRuns.conversationId, c.id))
    expect(runs.find((r) => r.workflowId === workflowIds[0])?.state).toBe('interrupted')
    expect(runs.find((r) => r.workflowId === workflowIds[1])?.state).toBe('waiting')
  })
  it('keeps visitor capture non-overwriting but accepts authorized anonymous corrections', async () => {
    const c = await conversation()
    await recordVisitorContact(c.id, { email: 'first@example.test' })
    expect((await row(c.id)).visitorEmail).toBe('visitor@example.test')
    await recordVisitorContact(c.id, { email: 'correct@example.test' }, { correct: true })
    expect((await row(c.id)).visitorEmail).toBe('correct@example.test')
    expect(
      (await db.select().from(principal).where(eq(principal.id, visitor)))[0].contactEmail
    ).toBe('correct@example.test')
    await db.update(principal).set({ type: 'user' }).where(eq(principal.id, visitor))
    await expect(
      recordVisitorContact(c.id, { email: 'other@example.test' }, { correct: true })
    ).rejects.toThrow('signed in')
    expect((await row(c.id)).visitorEmail).toBe('correct@example.test')
  })
  it('required email fails before creating a conversation', async () => {
    await db
      .update(settings)
      .set({
        widgetConfig: JSON.stringify({
          messenger: { contactCapture: { mode: 'required', askName: true } },
        }),
      })
      .where(eq(settings.id, workspace.id))
    for (const email of [undefined, 'invalid'])
      await expect(
        sendVisitorMessage(
          { content: 'Hello', visitorEmail: email },
          { principalId: visitor },
          { principalId: visitor, principalType: 'anonymous', role: 'user', segmentIds: new Set() }
        )
      ).rejects.toThrow('valid email')
    expect(
      await db.select().from(conversations).where(eq(conversations.visitorPrincipalId, visitor))
    ).toHaveLength(0)
  })
})
