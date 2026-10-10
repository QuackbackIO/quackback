/**
 * A close summary is bound to the close that queued it (close-summary.ts):
 * the summary jobs run late, retried or two at once, so a job must not
 * summarize a conversation or ticket that reopened or closed again since, must
 * not include messages written after its close, must never overwrite a newer
 * close's summary, and must not write once its deadline has passed.
 *
 * Real DB (rolled back): the conversation, ticket, messages, status-change
 * events and summary rows are real, and so are the transcript reads and the
 * locked write. Only the AI boundary is replaced: the chat call, whose input
 * is asserted, and the embedding call.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationMessages,
  conversations,
  conversationSummaries,
  events,
  principal,
  tickets,
  ticketStatuses,
  ticketSummaries,
  user,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/config', () => ({
  config: {
    s3PublicUrl: undefined,
    baseUrl: 'http://localhost:3000',
    openaiApiKey: 'test-key',
    openaiBaseUrl: 'http://localhost:9999/v1',
  },
  getBaseUrl: () => 'http://localhost:3000',
}))

const ai = vi.hoisted(() => ({
  chat: vi.fn(),
  generateEmbedding: vi.fn(),
}))
vi.mock('@tanstack/ai', () => ({ chat: ai.chat }))
vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: () => ({ kind: 'text' }),
}))
vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: () => true,
  structuredOutputProviderOptions: () => ({}),
}))
vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: () => ({ name: 'ai-usage-logging' }),
}))
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: () => 'test-model',
  getEmbeddingModel: () => 'test-embedding-model',
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: async () => undefined,
}))
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: ai.generateEmbedding,
}))

import { summarizeConversationOnClose } from '../conversation-summary.service'
import { summarizeTicketOnClose } from '../ticket-summary.service'
import type { TriggeringClose } from '../close-summary'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversationSummaries.id }).from(conversationSummaries).limit(0)
    await db.select({ id: ticketSummaries.id }).from(ticketSummaries).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
/** 2026-01-05 at the given UTC time. */
const at = (hhmm: string) => new Date(`2026-01-05T${hhmm}:00.000Z`)

/** An embedding the summary tables accept. */
const EMBEDDING = Array.from({ length: 1536 }, () => 0.01)

/** The text the model was asked to summarize, per call. */
const transcripts = () =>
  ai.chat.mock.calls.map(
    ([args]) => (args as { messages: { content: string }[] }).messages.at(-1)?.content ?? ''
  )

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

/** A status change's events-log row; returns the close it records when it closes. */
async function statusEvent(
  entityType: 'conversation' | 'ticket',
  entityId: string,
  previousStatus: string,
  newStatus: string,
  hhmm: string
): Promise<TriggeringClose> {
  const eventId = createId('event')
  await testDb.insert(events).values({
    eventId,
    type: `${entityType}.status_changed`,
    entityType,
    entityId,
    actorType: 'user',
    payload: { previousStatus, newStatus },
    occurredAt: at(hhmm),
  })
  return { eventId, at: at(hhmm) }
}

// --- conversations -----------------------------------------------------------

async function seedConversation() {
  const customer = await seedPrincipal()
  const agent = await seedPrincipal()
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: customer, channel: 'messenger' })
    .returning()
  const conversationId = row.id as ConversationId
  const write = (who: 'visitor' | 'agent', content: string, hhmm: string) =>
    testDb.insert(conversationMessages).values({
      conversationId,
      principalId: who === 'visitor' ? customer : agent,
      senderType: who,
      content,
      createdAt: at(hhmm),
    })
  await write('visitor', 'My March invoice charged me twice.', '09:00')
  await write('agent', 'Refunded the duplicate charge.', '09:10')
  return { conversationId, write }
}

async function setConversationStatus(
  conversationId: ConversationId,
  status: 'open' | 'closed',
  previous: 'open' | 'closed',
  hhmm: string
): Promise<TriggeringClose> {
  await testDb.update(conversations).set({ status }).where(eq(conversations.id, conversationId))
  return statusEvent('conversation', conversationId, previous, status, hhmm)
}

async function conversationSummary(conversationId: ConversationId) {
  const [row] = await testDb
    .select({ summary: conversationSummaries.summary })
    .from(conversationSummaries)
    .where(eq(conversationSummaries.conversationId, conversationId))
  return row?.summary ?? null
}

// --- tickets -----------------------------------------------------------------

async function seedTicket() {
  const requester = await seedPrincipal()
  const agent = await seedPrincipal()
  const [open, closed] = await testDb
    .insert(ticketStatuses)
    .values([
      { name: `Open ${suffix()}`, slug: `open_${suffix()}`, category: 'open' },
      { name: `Closed ${suffix()}`, slug: `closed_${suffix()}`, category: 'closed' },
    ])
    .returning()
  const [row] = await testDb
    .insert(tickets)
    .values({
      type: 'customer',
      title: `Ticket ${suffix()}`,
      statusId: open.id as TicketStatusId,
      requesterPrincipalId: requester,
    })
    .returning()
  const ticketId = row.id as TicketId
  const write = (who: 'visitor' | 'agent', content: string, hhmm: string) =>
    testDb.insert(conversationMessages).values({
      ticketId,
      principalId: who === 'visitor' ? requester : agent,
      senderType: who,
      content,
      createdAt: at(hhmm),
    })
  await write('visitor', 'SSO login fails with a redirect_uri mismatch.', '09:00')
  await write('agent', 'Re-added the new callback URL in the SSO settings.', '09:10')
  const setStatus = async (
    status: 'open' | 'closed',
    previous: 'open' | 'closed',
    hhmm: string
  ) => {
    await testDb
      .update(tickets)
      .set({ statusId: (status === 'open' ? open.id : closed.id) as TicketStatusId })
      .where(eq(tickets.id, ticketId))
    return statusEvent('ticket', ticketId, previous, status, hhmm)
  }
  return { ticketId, write, setStatus }
}

async function ticketSummary(ticketId: TicketId) {
  const [row] = await testDb
    .select({ summary: ticketSummaries.summary })
    .from(ticketSummaries)
    .where(eq(ticketSummaries.ticketId, ticketId))
  return row?.summary ?? null
}

describe.skipIf(!fixture.available)('a close summary bound to its close', () => {
  beforeEach(async () => {
    ai.chat.mockReset()
    ai.chat.mockResolvedValue({ summary: 'The summary.' })
    ai.generateEmbedding.mockReset()
    ai.generateEmbedding.mockResolvedValue(null)
    await fixture.begin()
  })
  afterEach(fixture.rollback)

  it("summarizes a conversation's messages up to its close, not after", async () => {
    const { conversationId, write } = await seedConversation()
    const close = await setConversationStatus(conversationId, 'closed', 'open', '09:20')
    // A message after the close that leaves it closed (a rating's reply, say).
    await write('visitor', 'Thanks, rated five stars.', '09:30')

    await summarizeConversationOnClose(conversationId, close)

    expect(transcripts()).toHaveLength(1)
    expect(transcripts()[0]).toContain('My March invoice charged me twice.')
    expect(transcripts()[0]).not.toContain('Thanks, rated five stars.')
    expect(await conversationSummary(conversationId)).toBe('The summary.')
  })

  it('skips a close the conversation has reopened since', async () => {
    const { conversationId } = await seedConversation()
    const close = await setConversationStatus(conversationId, 'closed', 'open', '09:20')
    await setConversationStatus(conversationId, 'open', 'closed', '09:25')

    await summarizeConversationOnClose(conversationId, close)

    expect(ai.chat).not.toHaveBeenCalled()
    expect(await conversationSummary(conversationId)).toBeNull()
  })

  it('skips a close the conversation has closed again since', async () => {
    const { conversationId } = await seedConversation()
    const first = await setConversationStatus(conversationId, 'closed', 'open', '09:20')
    await setConversationStatus(conversationId, 'open', 'closed', '09:25')
    await setConversationStatus(conversationId, 'closed', 'open', '09:40')

    await summarizeConversationOnClose(conversationId, first)

    expect(ai.chat).not.toHaveBeenCalled()
    expect(await conversationSummary(conversationId)).toBeNull()
  })

  it("an older close that finishes last never overwrites the newer close's summary", async () => {
    const { conversationId, write } = await seedConversation()
    const first = await setConversationStatus(conversationId, 'closed', 'open', '09:20')
    let finishFirst!: (value: { summary: string }) => void
    ai.chat.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve as typeof finishFirst))
    )
    ai.chat.mockResolvedValueOnce({ summary: 'The newer close.' })

    // The first close's job is waiting on the model when the conversation
    // reopens, gets another message, closes again, and that close's job runs.
    const older = summarizeConversationOnClose(conversationId, first)
    await vi.waitFor(() => expect(ai.chat).toHaveBeenCalledTimes(1))
    await setConversationStatus(conversationId, 'open', 'closed', '09:25')
    await write('visitor', 'One more thing about the refund.', '09:30')
    const second = await setConversationStatus(conversationId, 'closed', 'open', '09:40')
    await summarizeConversationOnClose(conversationId, second)
    finishFirst({ summary: 'The older close.' })
    await older

    expect(await conversationSummary(conversationId)).toBe('The newer close.')
  })

  it('an attempt past its deadline writes nothing, even when a call ignores the abort', async () => {
    const { conversationId } = await seedConversation()
    const close = await setConversationStatus(conversationId, 'closed', 'open', '09:20')
    // The embedding call is handed the deadline, and settles only after it
    // passes, as a request that ignores the abort would.
    let embeddingStarted!: () => void
    const started = new Promise<void>((resolve) => (embeddingStarted = resolve))
    ai.generateEmbedding.mockImplementation(
      (_text: string, _context: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          embeddingStarted()
          opts?.signal?.addEventListener('abort', () => resolve(EMBEDDING))
        })
    )
    const deadline = new AbortController()

    const run = summarizeConversationOnClose(conversationId, close, { signal: deadline.signal })
    await started
    deadline.abort(new Error('event reactions passed their deadline'))
    await run

    expect(await conversationSummary(conversationId)).toBeNull()
  })

  it("summarizes a ticket's messages up to its close, not after", async () => {
    const { ticketId, write, setStatus } = await seedTicket()
    const close = await setStatus('closed', 'open', '09:20')
    await write('visitor', 'Thanks, all good now.', '09:30')

    await summarizeTicketOnClose(ticketId, close)

    expect(transcripts()).toHaveLength(1)
    expect(transcripts()[0]).toContain('redirect_uri mismatch')
    expect(transcripts()[0]).not.toContain('Thanks, all good now.')
    expect(await ticketSummary(ticketId)).toBe('The summary.')
  })

  it('skips a close the ticket has reopened since', async () => {
    const { ticketId, setStatus } = await seedTicket()
    const close = await setStatus('closed', 'open', '09:20')
    await setStatus('open', 'closed', '09:25')

    await summarizeTicketOnClose(ticketId, close)

    expect(ai.chat).not.toHaveBeenCalled()
    expect(await ticketSummary(ticketId)).toBeNull()
  })

  it('skips a close the ticket has closed again since', async () => {
    const { ticketId, setStatus } = await seedTicket()
    const first = await setStatus('closed', 'open', '09:20')
    await setStatus('open', 'closed', '09:25')
    await setStatus('closed', 'open', '09:40')

    await summarizeTicketOnClose(ticketId, first)

    expect(ai.chat).not.toHaveBeenCalled()
    expect(await ticketSummary(ticketId)).toBeNull()
  })

  it('a ticket summary past its deadline writes nothing', async () => {
    const { ticketId, setStatus } = await seedTicket()
    const close = await setStatus('closed', 'open', '09:20')
    let embeddingStarted!: () => void
    const started = new Promise<void>((resolve) => (embeddingStarted = resolve))
    ai.generateEmbedding.mockImplementation(
      (_text: string, _context: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          embeddingStarted()
          opts?.signal?.addEventListener('abort', () => resolve(null))
        })
    )
    const deadline = new AbortController()

    const run = summarizeTicketOnClose(ticketId, close, { signal: deadline.signal })
    await started
    deadline.abort(new Error('event reactions passed their deadline'))
    await run

    expect(await ticketSummary(ticketId)).toBeNull()
  })
})
