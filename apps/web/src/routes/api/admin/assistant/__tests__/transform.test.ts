/**
 * Unit tests for POST /api/admin/assistant/transform: the same gate order as
 * copilot.ts (permission -> flag -> AI-configured -> budget ->
 * conversation-viewable), the AG-UI request parsing (the transform kind on
 * forwardedProps, the source text as the trailing user message), the canonical
 * RUN_STARTED/RUN_FINISHED(result) stream, and that `runCopilotTransform` is
 * called with the acting teammate's principal id and the exact source text,
 * never the conversation's messages (this route only uses the conversation to
 * authorize the caller). `streamSynthesisToWire` runs for real (its lifecycle
 * mechanics are pinned in agui.test.ts); only `runCopilotTransform` is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireAuth = vi.fn()
const mockPolicyActorFromAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  policyActorFromAuth: (...args: unknown[]) => mockPolicyActorFromAuth(...args),
}))
// The gate's 403-vs-500 split discriminates on isAuthDenialError, imported from
// the pure leaf auth-errors.ts — left unmocked so the denial tests run against
// the REAL vocabulary matcher.

const mockIsAssistantConfigured = vi.fn()
const mockRunCopilotTransform = vi.fn()
vi.mock('@/lib/server/domains/assistant', () => ({
  isAssistantConfigured: (...args: unknown[]) => mockIsAssistantConfigured(...args),
  runCopilotTransform: (...args: unknown[]) => mockRunCopilotTransform(...args),
}))

const mockIsFeatureEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}))

const mockAssertConversationViewable = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: (...args: unknown[]) => mockAssertConversationViewable(...args),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

// `assertTicketVisible` (copilot-gate.ts) is real here — see copilot.test.ts's
// identical mock for why a module-level override would never be seen by its
// internal caller (gateCopilotAguiRequest, same file). Faking `db.select`'s
// chain is enough since `ticketFilter` is a pure SQL-fragment builder.
const mockTicketLookup = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: (...args: unknown[]) => mockTicketLookup(...args),
          })),
        })),
      })),
    },
  }
})

import { handleTransform } from '../transform'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { NotFoundError } from '@/lib/shared/errors'
import { generateId } from '@quackback/ids'

const CONVERSATION_ID = generateId('conversation')
const TICKET_ID = generateId('ticket')
const PRINCIPAL_ID = 'principal_1'
const SOURCE_TEXT = 'Thanks for reaching out, we will look into it.'

/** Build an AG-UI RunAgentInput body: the source text as the trailing user
 *  message, plus the item ref + transform kind on forwardedProps. */
function aguiBody(options: {
  forwardedProps?: Record<string, unknown>
  text?: string
}): Record<string, unknown> {
  return {
    threadId: 'thread-test',
    runId: 'run-test',
    messages: options.text !== undefined ? [{ id: 't', role: 'user', content: options.text }] : [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: options.forwardedProps ?? {},
  }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/assistant/transform', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** Parse toServerSentEventsResponse output: `data: <json>` blocks. */
function parseAguiSse(text: string): Array<Record<string, unknown> & { type: string }> {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue({ principal: { id: PRINCIPAL_ID } })
  mockPolicyActorFromAuth.mockResolvedValue({ principalId: PRINCIPAL_ID })
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockIsAssistantConfigured.mockReturnValue(true)
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockAssertConversationViewable.mockResolvedValue({ id: CONVERSATION_ID })
  mockTicketLookup.mockResolvedValue([{ id: TICKET_ID }])
  mockRunCopilotTransform.mockResolvedValue({ text: 'Rewritten.' })
})

const validBody = () =>
  aguiBody({
    forwardedProps: { conversationId: CONVERSATION_ID, transform: 'more_friendly' },
    text: SOURCE_TEXT,
  })

describe('POST /api/admin/assistant/transform', () => {
  it('403s when the caller lacks copilot.use', async () => {
    mockRequireAuth.mockRejectedValue(
      new Error("Access denied: Requires permission 'copilot.use', role member lacks it")
    )
    const res = await handleTransform({ request: makeRequest(validBody()) })
    expect(res.status).toBe(403)
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
  })

  it('rethrows an infrastructure failure from the auth check instead of mapping it to 403', async () => {
    mockRequireAuth.mockRejectedValue(new Error('session store unavailable'))
    await expect(handleTransform({ request: makeRequest(validBody()) })).rejects.toThrow(
      'session store unavailable'
    )
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
  })

  it('400s on a non-AG-UI body', async () => {
    const res = await handleTransform({
      request: makeRequest({
        conversationId: CONVERSATION_ID,
        text: 'hi',
        transform: 'more_friendly',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('400s when the AG-UI messages carry no source text', async () => {
    const res = await handleTransform({
      request: makeRequest(
        aguiBody({
          forwardedProps: { conversationId: CONVERSATION_ID, transform: 'more_friendly' },
        })
      ),
    })
    expect(res.status).toBe(400)
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
  })

  it('400s on an unknown transform kind', async () => {
    const res = await handleTransform({
      request: makeRequest(
        aguiBody({
          forwardedProps: { conversationId: CONVERSATION_ID, transform: 'make_it_pop' },
          text: SOURCE_TEXT,
        })
      ),
    })
    expect(res.status).toBe(400)
  })

  it('400s when translate carries no target language', async () => {
    const res = await handleTransform({
      request: makeRequest(
        aguiBody({
          forwardedProps: { conversationId: CONVERSATION_ID, transform: 'translate' },
          text: SOURCE_TEXT,
        })
      ),
    })
    expect(res.status).toBe(400)
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
  })

  it('passes the target language through to runCopilotTransform for translate', async () => {
    const res = await handleTransform({
      request: makeRequest(
        aguiBody({
          forwardedProps: {
            conversationId: CONVERSATION_ID,
            transform: 'translate',
            language: 'Spanish',
          },
          text: SOURCE_TEXT,
        })
      ),
    })
    expect(res.status).toBe(200)
    await res.text()
    expect(mockRunCopilotTransform).toHaveBeenCalledWith(
      expect.objectContaining({
        transform: 'translate',
        language: 'Spanish',
        text: SOURCE_TEXT,
      })
    )
  })

  it('400s on a malformed conversationId', async () => {
    const res = await handleTransform({
      request: makeRequest(
        aguiBody({
          forwardedProps: { conversationId: 'not-a-typeid', transform: 'more_friendly' },
          text: SOURCE_TEXT,
        })
      ),
    })
    expect(res.status).toBe(400)
  })

  it('503s when the assistant is not configured', async () => {
    mockIsAssistantConfigured.mockReturnValue(false)
    const res = await handleTransform({ request: makeRequest(validBody()) })
    expect(res.status).toBe(503)
    expect(mockEnforceAiTokenBudget).not.toHaveBeenCalled()
  })

  it('responds with the tier-limit error when the ai token budget is exceeded', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', message: "You've used your AI budget" })
    )
    const res = await handleTransform({ request: makeRequest(validBody()) })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error.code).toBe('TIER_LIMIT_EXCEEDED')
    expect(mockAssertConversationViewable).not.toHaveBeenCalled()
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
  })

  it('404s when the conversation does not exist (or is not viewable)', async () => {
    mockAssertConversationViewable.mockRejectedValue(
      new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
    )
    const res = await handleTransform({ request: makeRequest(validBody()) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('CONVERSATION_NOT_FOUND')
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
  })

  it('streams RUN_STARTED, forwarded model chunks, then RUN_FINISHED.result with the rewritten text', async () => {
    mockRunCopilotTransform.mockImplementation(
      async (input: { wireSink?: (chunk: unknown) => void }) => {
        input.wireSink?.({ type: 'TEXT_MESSAGE_START', messageId: 'm1' })
        input.wireSink?.({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '{"text":"Sure' })
        input.wireSink?.({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ' thing!"}' })
        input.wireSink?.({ type: 'TEXT_MESSAGE_END', messageId: 'm1' })
        return { text: 'Sure thing!' }
      }
    )

    const res = await handleTransform({ request: makeRequest(validBody()) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')

    const chunks = parseAguiSse(await res.text())
    expect(chunks[0]).toMatchObject({
      type: 'RUN_STARTED',
      threadId: 'thread-test',
      runId: 'run-test',
    })
    expect(chunks.some((c) => c.type === 'TEXT_MESSAGE_CONTENT')).toBe(true)
    const finished = chunks.at(-1) as { type: string; result?: unknown }
    expect(finished).toMatchObject({ type: 'RUN_FINISHED' })
    expect(finished.result).toEqual({ text: 'Sure thing!' })
  })

  it('ends the stream with a coded RUN_ERROR when the transform throws', async () => {
    mockRunCopilotTransform.mockRejectedValue(new Error('model exploded'))

    const res = await handleTransform({ request: makeRequest(validBody()) })
    const chunks = parseAguiSse(await res.text())
    const terminal = chunks.at(-1) as { type: string; code?: string; message?: string }
    expect(terminal).toMatchObject({
      type: 'RUN_ERROR',
      code: 'TRANSFORM_FAILED',
      message: 'Transform failed',
    })
    expect(chunks.some((c) => c.type === 'RUN_FINISHED')).toBe(false)
    expect(JSON.stringify(chunks)).not.toContain('model exploded')
  })

  it('calls runCopilotTransform with the acting principal, the transform, and the exact source text, never the conversation', async () => {
    await handleTransform({ request: makeRequest(validBody()) })
    // Drain the stream so the detached run has definitely been invoked.
    expect(mockRunCopilotTransform).toHaveBeenCalledWith(
      expect.objectContaining({
        transform: 'more_friendly',
        text: SOURCE_TEXT,
        principalId: PRINCIPAL_ID,
      })
    )
    expect(mockRunCopilotTransform.mock.calls[0][0]).not.toHaveProperty('conversationId')
  })

  it('uses the conversation only to authorize the caller (assertConversationViewable runs, but the id never reaches the transform)', async () => {
    await handleTransform({ request: makeRequest(validBody()) })
    expect(mockAssertConversationViewable).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ principalId: PRINCIPAL_ID })
    )
  })
})

describe('POST /api/admin/assistant/transform: ticket-scoped (unified inbox §2.9)', () => {
  const ticketBody = () =>
    aguiBody({
      forwardedProps: { ticketId: TICKET_ID, transform: 'more_friendly' },
      text: SOURCE_TEXT,
    })

  it('400s when both conversationId and ticketId are present', async () => {
    const res = await handleTransform({
      request: makeRequest(
        aguiBody({
          forwardedProps: {
            conversationId: CONVERSATION_ID,
            ticketId: TICKET_ID,
            transform: 'more_friendly',
          },
          text: SOURCE_TEXT,
        })
      ),
    })
    expect(res.status).toBe(400)
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
  })

  it('404s when the ticket does not exist (or is not viewable)', async () => {
    mockTicketLookup.mockResolvedValue([])
    const res = await handleTransform({ request: makeRequest(ticketBody()) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('TICKET_NOT_FOUND')
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
  })

  it('runs the transform for a viewable ticket, authorizing via the ticket rather than a conversation', async () => {
    const res = await handleTransform({ request: makeRequest(ticketBody()) })
    expect(res.status).toBe(200)
    await res.text()
    expect(mockAssertConversationViewable).not.toHaveBeenCalled()
    expect(mockRunCopilotTransform).toHaveBeenCalledWith(
      expect.objectContaining({ transform: 'more_friendly', text: SOURCE_TEXT })
    )
  })
})
