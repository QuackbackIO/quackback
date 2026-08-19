/**
 * Unit tests for POST /api/admin/assistant/copilot: the permission gate, the
 * flag gate, the AI-configured/budget gates, the item-viewable gate, the
 * AG-UI request parsing (RunAgentInput with the item ref on forwardedProps),
 * and the final-payload mapping. `streamAssistantTurn` is mocked throughout —
 * its wire mechanics (canonical lifecycle pair, commit buffering, activity
 * chunks) are pinned in assistant.runtime.test.ts; these tests pin what THIS
 * route does: gating, history mapping onto the runtime's thread vocabulary,
 * turn-input construction (explicit `copilot_qa` boundary), and the
 * CopilotFinalPayload it builds for `quackback:final`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireAuth = vi.fn()
const mockPolicyActorFromAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  policyActorFromAuth: (...args: unknown[]) => mockPolicyActorFromAuth(...args),
}))
// The gate's 403-vs-500 split discriminates on isAuthDenialError, which the
// gate imports from the pure leaf module auth-errors.ts — left unmocked here
// so the denial tests below run against the REAL vocabulary matcher.

const mockIsAssistantConfigured = vi.fn()
const mockStreamAssistantTurn = vi.fn()
const mockEnsureAssistantPrincipal = vi.fn()
vi.mock('@/lib/server/domains/assistant', () => ({
  isAssistantConfigured: (...args: unknown[]) => mockIsAssistantConfigured(...args),
  streamAssistantTurn: (...args: unknown[]) => mockStreamAssistantTurn(...args),
  ensureAssistantPrincipal: (...args: unknown[]) => mockEnsureAssistantPrincipal(...args),
}))

const mockIsFeatureEnabled = vi.fn()
const mockIsCopilotCapabilityEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  isCopilotCapabilityEnabled: (...args: unknown[]) => mockIsCopilotCapabilityEnabled(...args),
}))

const mockAssertConversationViewable = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: (...args: unknown[]) => mockAssertConversationViewable(...args),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

// `assertTicketViewable` (copilot-gate.ts) is real here, not mocked as a
// module — it's called from WITHIN gateCopilotAguiRequest in the same file, so
// a module-level mock override would never be seen by that internal call (ESM
// self-reference). Instead, fake the one thing it touches: the `db.select`
// chain, mirroring assistant.runtime.test.ts's conversation-lookup mock.
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

import { handleCopilot } from '../copilot'
import type { StreamAssistantTurnOptions } from '@/lib/server/domains/assistant/assistant.runtime'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { NotFoundError } from '@/lib/shared/errors'
import { generateId } from '@quackback/ids'

const CONVERSATION_ID = generateId('conversation')
const TICKET_ID = generateId('ticket')

/** Build an AG-UI RunAgentInput body around the question + forwardedProps. */
function aguiBody(options: {
  forwardedProps?: Record<string, unknown>
  question?: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}): Record<string, unknown> {
  const history = options.history ?? []
  return {
    threadId: 'thread-test',
    runId: 'run-test',
    messages: [
      ...history.map((h, i) => ({ id: `h${i}`, role: h.role, content: h.content })),
      ...(options.question !== undefined
        ? [{ id: 'q', role: 'user', content: options.question }]
        : []),
    ],
    tools: [],
    context: [],
    state: {},
    forwardedProps: options.forwardedProps ?? {},
  }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/assistant/copilot', {
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

/** The turn result the mocked streamAssistantTurn maps through the route's
 *  buildFinalPayload — set per test to exercise the payload mapping. */
let nextTurnResult: unknown

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1' } })
  mockPolicyActorFromAuth.mockResolvedValue({ principalId: 'principal_1' })
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockIsCopilotCapabilityEnabled.mockResolvedValue(true)
  mockIsAssistantConfigured.mockReturnValue(true)
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockAssertConversationViewable.mockResolvedValue({ id: CONVERSATION_ID })
  mockTicketLookup.mockResolvedValue([{ id: TICKET_ID }])
  mockEnsureAssistantPrincipal.mockResolvedValue({ id: 'principal_assistant' })
  nextTurnResult = {
    status: 'answered',
    text: 'ok',
    citations: [],
    internalSourced: false,
    proposedActions: [],
  }
  mockStreamAssistantTurn.mockImplementation((options: StreamAssistantTurnOptions) =>
    (async function* () {
      yield { type: 'RUN_STARTED', ...options.wire }
      // The post-processed payload rides AG-UI's standard RUN_FINISHED.result.
      yield {
        type: 'RUN_FINISHED',
        ...options.wire,
        finishReason: 'stop',
        result: options.buildFinalPayload(nextTurnResult as never),
      }
    })()
  )
})

const validBody = () =>
  aguiBody({
    forwardedProps: { conversationId: CONVERSATION_ID },
    question: 'What is the refund policy?',
  })

/** The turn input the route handed to streamAssistantTurn. */
function turnInput(): Record<string, unknown> {
  return (mockStreamAssistantTurn.mock.calls[0][0] as StreamAssistantTurnOptions)
    .input as unknown as Record<string, unknown>
}

describe('POST /api/admin/assistant/copilot', () => {
  it('403s when the caller lacks copilot.use', async () => {
    mockRequireAuth.mockRejectedValue(
      new Error("Access denied: Requires permission 'copilot.use', role member lacks it")
    )
    const res = await handleCopilot({ request: makeRequest(validBody()) })
    expect(res.status).toBe(403)
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('403s an unauthenticated caller (the other half of the denial vocabulary)', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'))
    const res = await handleCopilot({ request: makeRequest(validBody()) })
    expect(res.status).toBe(403)
  })

  it('rethrows an infrastructure failure from the auth check instead of mapping it to 403', async () => {
    mockRequireAuth.mockRejectedValue(new Error('session store unavailable'))
    await expect(handleCopilot({ request: makeRequest(validBody()) })).rejects.toThrow(
      'session store unavailable'
    )
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('400s on a non-AG-UI body', async () => {
    const res = await handleCopilot({
      request: makeRequest({ conversationId: CONVERSATION_ID, question: 'hi' }),
    })
    expect(res.status).toBe(400)
  })

  it('400s when the AG-UI messages carry no trailing user question', async () => {
    const res = await handleCopilot({
      request: makeRequest(
        aguiBody({
          forwardedProps: { conversationId: CONVERSATION_ID },
          history: [{ role: 'assistant', content: 'a previous answer' }],
        })
      ),
    })
    expect(res.status).toBe(400)
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('400s on a malformed conversationId in forwardedProps', async () => {
    const res = await handleCopilot({
      request: makeRequest(
        aguiBody({ forwardedProps: { conversationId: 'not-a-typeid' }, question: 'hi' })
      ),
    })
    expect(res.status).toBe(400)
  })

  it('404s when the inboxAi flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const res = await handleCopilot({ request: makeRequest(validBody()) })
    expect(res.status).toBe(404)
    expect(mockIsAssistantConfigured).not.toHaveBeenCalled()
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('404s when the qa capability is off (v3 config gate)', async () => {
    mockIsCopilotCapabilityEnabled.mockResolvedValue(false)
    const res = await handleCopilot({ request: makeRequest(validBody()) })
    expect(res.status).toBe(404)
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('503s when the assistant is not configured', async () => {
    mockIsAssistantConfigured.mockReturnValue(false)
    const res = await handleCopilot({ request: makeRequest(validBody()) })
    expect(res.status).toBe(503)
    expect(mockEnforceAiTokenBudget).not.toHaveBeenCalled()
  })

  it('responds with the tier-limit error when the ai token budget is exceeded', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', message: "You've used your AI budget" })
    )
    const res = await handleCopilot({ request: makeRequest(validBody()) })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error.code).toBe('TIER_LIMIT_EXCEEDED')
    expect(mockAssertConversationViewable).not.toHaveBeenCalled()
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('404s when the conversation does not exist (or is not viewable)', async () => {
    mockAssertConversationViewable.mockRejectedValue(
      new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
    )
    const res = await handleCopilot({ request: makeRequest(validBody()) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('CONVERSATION_NOT_FOUND')
    expect(mockEnsureAssistantPrincipal).not.toHaveBeenCalled()
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('streams AG-UI frames ending with RUN_FINISHED.result, echoing the request run ids', async () => {
    nextTurnResult = {
      status: 'answered',
      text: 'Here you go.',
      citations: [
        { type: 'snippet', id: 'assistant_snippet_1', title: 'S', url: '', internal: true },
      ],
      internalSourced: true,
      proposedActions: [],
      answerType: 'analysis',
    }

    const res = await handleCopilot({ request: makeRequest(validBody()) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')

    const chunks = parseAguiSse(await res.text())
    expect(chunks[0]).toMatchObject({
      type: 'RUN_STARTED',
      threadId: 'thread-test',
      runId: 'run-test',
    })
    const finished = chunks.at(-1) as { type: string; result?: unknown }
    expect(finished).toMatchObject({ type: 'RUN_FINISHED' })
    expect(finished.result).toEqual({
      text: 'Here you go.',
      citations: [
        { type: 'snippet', id: 'assistant_snippet_1', title: 'S', url: '', internal: true },
      ],
      internalSourced: true,
      proposedActions: [],
      // The runtime's answerType classification is relayed verbatim.
      answerType: 'analysis',
    })
  })

  it('maps a suppressed turn onto the muted final payload', async () => {
    nextTurnResult = { status: 'suppressed', reason: 'silence' }

    const res = await handleCopilot({ request: makeRequest(validBody()) })
    const chunks = parseAguiSse(await res.text())
    const finished = chunks.at(-1) as { result?: unknown }
    expect(finished.result).toEqual({
      text: '',
      citations: [],
      internalSourced: false,
      suppressed: 'silence',
      proposedActions: [],
      // No text ⇒ no action buttons; the neutral default keeps it well-formed.
      answerType: 'draft_reply',
    })
  })

  it('calls the runtime seam with the explicit Copilot Q&A boundary, never the orchestrator', async () => {
    await handleCopilot({ request: makeRequest(validBody()) })

    expect(turnInput()).toMatchObject({
      conversationId: CONVERSATION_ID,
      role: 'copilot_qa',
      surface: 'copilot',
    })
    expect(turnInput()).not.toHaveProperty('simulate')
    expect(turnInput()).not.toHaveProperty('askerActor')
    expect(turnInput()).not.toHaveProperty('writeToolPolicy')
  })

  it('attributes the turn to the asking teammate for the Copilot usage report', async () => {
    await handleCopilot({ request: makeRequest(validBody()) })
    expect(turnInput()).toMatchObject({ actorPrincipalId: 'principal_1' })
  })

  it('uses the resolved actor only for the viewability gate, not as runtime policy input', async () => {
    const resolvedActor = {
      principalId: 'principal_1',
      permissions: new Set(['conversation.set_attributes']),
    }
    mockPolicyActorFromAuth.mockResolvedValue(resolvedActor)

    await handleCopilot({ request: makeRequest(validBody()) })

    expect(mockAssertConversationViewable).toHaveBeenCalledWith(CONVERSATION_ID, resolvedActor)
    expect(turnInput()).not.toHaveProperty('askerActor')
  })

  it('relays a turn that proposed a write-tool action: the pending action surfaces on the final payload untouched', async () => {
    nextTurnResult = {
      status: 'answered',
      text: "I've proposed closing this conversation for you.",
      citations: [],
      internalSourced: false,
      proposedActions: [
        {
          id: 'assistant_action_1',
          toolName: 'end_conversation',
          summary: 'Close the conversation',
        },
      ],
    }

    const res = await handleCopilot({ request: makeRequest(validBody()) })
    const chunks = parseAguiSse(await res.text())
    const finished = chunks.at(-1) as { result?: { proposedActions?: unknown } }
    expect(finished.result?.proposedActions).toEqual([
      {
        id: 'assistant_action_1',
        toolName: 'end_conversation',
        summary: 'Close the conversation',
      },
    ])
  })

  it('maps AG-UI user history to customer-sender turns and assistant history to assistant-sender turns, question last', async () => {
    await handleCopilot({
      request: makeRequest(
        aguiBody({
          forwardedProps: { conversationId: CONVERSATION_ID },
          history: [
            { role: 'user', content: 'earlier question' },
            { role: 'assistant', content: 'earlier answer' },
          ],
          question: 'What is the refund policy?',
        })
      ),
    })

    expect(turnInput()).toMatchObject({
      messages: [
        { sender: 'customer', content: 'earlier question' },
        { sender: 'assistant', content: 'earlier answer' },
        { sender: 'customer', content: 'What is the refund policy?' },
      ],
    })
  })

  it('recovers assistant history prose from a structured-JSON content (a useChat-resent answer)', async () => {
    const body = aguiBody({
      forwardedProps: { conversationId: CONVERSATION_ID },
      question: 'And the follow-up?',
    })
    // uiMessagesToWire flattens a structured-output part into `content` as the
    // raw JSON string; the AG-UI schema strips `parts` server-side.
    ;(body.messages as unknown[]).unshift({
      id: 'a1',
      role: 'assistant',
      content: '{"text":"Earlier structured answer.","citations":[]}',
    })

    await handleCopilot({ request: makeRequest(body) })

    expect(turnInput()).toMatchObject({
      messages: [
        { sender: 'assistant', content: 'Earlier structured answer.' },
        { sender: 'customer', content: 'And the follow-up?' },
      ],
    })
  })

  it('forwards sourceTypes from forwardedProps into the turn', async () => {
    await handleCopilot({
      request: makeRequest(
        aguiBody({
          forwardedProps: {
            conversationId: CONVERSATION_ID,
            sourceTypes: ['article', 'snippet'],
          },
          question: 'hi',
        })
      ),
    })

    expect(turnInput()).toMatchObject({ sourceTypes: ['article', 'snippet'] })
  })
})

describe('POST /api/admin/assistant/copilot: ticket-scoped (unified inbox §2.9)', () => {
  const ticketBody = () =>
    aguiBody({
      forwardedProps: { ticketId: TICKET_ID },
      question: 'What is the refund policy?',
    })

  it('400s when both conversationId and ticketId are present (exactly one is required)', async () => {
    const res = await handleCopilot({
      request: makeRequest(
        aguiBody({
          forwardedProps: { conversationId: CONVERSATION_ID, ticketId: TICKET_ID },
          question: 'hi',
        })
      ),
    })
    expect(res.status).toBe(400)
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('400s when neither conversationId nor ticketId is present', async () => {
    const res = await handleCopilot({
      request: makeRequest(aguiBody({ forwardedProps: {}, question: 'hi' })),
    })
    expect(res.status).toBe(400)
  })

  it('400s on a malformed ticketId', async () => {
    const res = await handleCopilot({
      request: makeRequest(
        aguiBody({ forwardedProps: { ticketId: 'not-a-typeid' }, question: 'hi' })
      ),
    })
    expect(res.status).toBe(400)
  })

  it('404s when the ticket does not exist (or is not viewable)', async () => {
    mockTicketLookup.mockResolvedValue([])
    const res = await handleCopilot({ request: makeRequest(ticketBody()) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('TICKET_NOT_FOUND')
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('calls the runtime with the ticketId and explicit Copilot Q&A boundary', async () => {
    const res = await handleCopilot({ request: makeRequest(ticketBody()) })
    expect(res.status).toBe(200)

    expect(turnInput()).toMatchObject({
      conversationId: null,
      ticketId: TICKET_ID,
      role: 'copilot_qa',
      surface: 'copilot',
    })
    // The conversation-viewable gate is never consulted for a ticket-scoped request.
    expect(mockAssertConversationViewable).not.toHaveBeenCalled()
  })

  it('conversation-scoped payloads are unaffected: the ticket lookup is never consulted', async () => {
    await handleCopilot({ request: makeRequest(validBody()) })
    expect(mockTicketLookup).not.toHaveBeenCalled()
    expect(turnInput()).toMatchObject({ conversationId: CONVERSATION_ID, ticketId: null })
  })
})
