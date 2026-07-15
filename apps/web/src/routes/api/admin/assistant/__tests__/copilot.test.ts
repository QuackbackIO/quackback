/**
 * Unit tests for POST /api/admin/assistant/copilot: the permission gate, the
 * flag gate, the AI-configured/budget gates, the conversation-exists gate,
 * the SSE turn stream, and the safety property that matters most: that this
 * route never writes to the conversation (no involvement row, no unread-count
 * change) beyond the documented exception: a write-tool call
 * proposes (creates a pending-action row plus its announcing internal note)
 * rather than executing or writing anything else. `runAssistantTurn` itself
 * is mocked throughout this file, so the pipeline behavior that enforces
 * "propose never executes" is pinned in assistant.tools.test.ts; these tests
 * only pin what THIS route does with the result, including selecting the
 * explicit `copilot_qa` role and relaying `proposedActions` untouched.
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
const mockRunAssistantTurn = vi.fn()
const mockEnsureAssistantPrincipal = vi.fn()
vi.mock('@/lib/server/domains/assistant', () => ({
  isAssistantConfigured: (...args: unknown[]) => mockIsAssistantConfigured(...args),
  runAssistantTurn: (...args: unknown[]) => mockRunAssistantTurn(...args),
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
// module — it's called from WITHIN gateCopilotRequest in the same file, so a
// module-level mock override would never be seen by that internal call (ESM
// self-reference). Instead, fake the one thing it touches: the `db.select`
// chain, mirroring assistant.runtime.test.ts's conversation-lookup mock. Every
// other db export (tickets, eq, and — all pure/schema-only) stays real, since
// `ticketFilter` itself is a pure SQL-fragment builder that never touches a
// live connection.
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
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { NotFoundError } from '@/lib/shared/errors'
import { parseAskAiSseBlock } from '@/components/help-center/ask-ai'
import { generateId } from '@quackback/ids'

const CONVERSATION_ID = generateId('conversation')
const TICKET_ID = generateId('ticket')

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/assistant/copilot', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function parseSse(text: string): Array<{ event: string; data: unknown }> {
  return text
    .split('\n\n')
    .map(parseAskAiSseBlock)
    .filter((frame): frame is { event: string; data: unknown } => frame !== null)
}

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
  mockRunAssistantTurn.mockResolvedValue({
    status: 'answered',
    text: 'ok',
    citations: [],
    internalSourced: false,
    proposedActions: [],
  })
})

const validBody = { conversationId: CONVERSATION_ID, question: 'What is the refund policy?' }

describe('POST /api/admin/assistant/copilot', () => {
  it('403s when the caller lacks copilot.use', async () => {
    // A genuine denial, in requireAuth's own message vocabulary — the gate
    // discriminates on it (see auth-helpers.ts's isAuthDenialError).
    mockRequireAuth.mockRejectedValue(
      new Error("Access denied: Requires permission 'copilot.use', role member lacks it")
    )
    const res = await handleCopilot({ request: makeRequest(validBody) })
    expect(res.status).toBe(403)
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('403s an unauthenticated caller (the other half of the denial vocabulary)', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'))
    const res = await handleCopilot({ request: makeRequest(validBody) })
    expect(res.status).toBe(403)
  })

  it('rethrows an infrastructure failure from the auth check instead of mapping it to 403', async () => {
    // A transient session-store failure is a 500, never "Copilot access
    // required" — the gate only maps requireAuth's denial vocabulary.
    mockRequireAuth.mockRejectedValue(new Error('session store unavailable'))
    await expect(handleCopilot({ request: makeRequest(validBody) })).rejects.toThrow(
      'session store unavailable'
    )
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('400s on an invalid body (missing question)', async () => {
    const res = await handleCopilot({ request: makeRequest({ conversationId: CONVERSATION_ID }) })
    expect(res.status).toBe(400)
  })

  it('400s on a malformed conversationId', async () => {
    const res = await handleCopilot({
      request: makeRequest({ ...validBody, conversationId: 'not-a-typeid' }),
    })
    expect(res.status).toBe(400)
  })

  it('404s when the inboxAi flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const res = await handleCopilot({ request: makeRequest(validBody) })
    expect(res.status).toBe(404)
    expect(mockIsAssistantConfigured).not.toHaveBeenCalled()
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('404s when the qa capability is off (v3 config gate)', async () => {
    mockIsCopilotCapabilityEnabled.mockResolvedValue(false)
    const res = await handleCopilot({ request: makeRequest(validBody) })
    expect(res.status).toBe(404)
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('503s when the assistant is not configured', async () => {
    mockIsAssistantConfigured.mockReturnValue(false)
    const res = await handleCopilot({ request: makeRequest(validBody) })
    expect(res.status).toBe(503)
    expect(mockEnforceAiTokenBudget).not.toHaveBeenCalled()
  })

  it('responds with the tier-limit error when the ai token budget is exceeded', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', message: "You've used your AI budget" })
    )
    const res = await handleCopilot({ request: makeRequest(validBody) })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error.code).toBe('TIER_LIMIT_EXCEEDED')
    expect(mockAssertConversationViewable).not.toHaveBeenCalled()
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('404s when the conversation does not exist (or is not viewable)', async () => {
    mockAssertConversationViewable.mockRejectedValue(
      new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
    )
    const res = await handleCopilot({ request: makeRequest(validBody) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('CONVERSATION_NOT_FOUND')
    expect(mockEnsureAssistantPrincipal).not.toHaveBeenCalled()
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('streams delta then final with citations and internalSourced', async () => {
    mockRunAssistantTurn.mockImplementation(
      async (input: { onTextDelta?: (t: string) => void }) => {
        input.onTextDelta?.('Here')
        input.onTextDelta?.(' you go.')
        return {
          status: 'answered',
          text: 'Here you go.',
          citations: [
            { type: 'snippet', id: 'assistant_snippet_1', title: 'S', url: '', internal: true },
          ],
          internalSourced: true,
          proposedActions: [],
          answerType: 'analysis',
        }
      }
    )

    const res = await handleCopilot({ request: makeRequest(validBody) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')

    const frames = parseSse(await res.text())
    expect(frames.some((f) => f.event === 'copilot.v1.delta')).toBe(true)
    expect(frames.at(-1)).toEqual({
      event: 'copilot.v1.final',
      data: {
        text: 'Here you go.',
        citations: [
          { type: 'snippet', id: 'assistant_snippet_1', title: 'S', url: '', internal: true },
        ],
        internalSourced: true,
        proposedActions: [],
        // The runtime's answerType classification is relayed verbatim.
        answerType: 'analysis',
      },
    })
  })

  it('streams a suppressed final payload when the engine mutes Quinn', async () => {
    mockRunAssistantTurn.mockResolvedValue({ status: 'suppressed', reason: 'silence' })

    const res = await handleCopilot({ request: makeRequest(validBody) })
    const frames = parseSse(await res.text())
    expect(frames.at(-1)).toEqual({
      event: 'copilot.v1.final',
      data: {
        text: '',
        citations: [],
        internalSourced: false,
        suppressed: 'silence',
        proposedActions: [],
        // No text ⇒ no action buttons; the neutral default keeps it well-formed.
        answerType: 'draft_reply',
      },
    })
  })

  it('calls the runtime directly with the explicit Copilot Q&A boundary, never the orchestrator', async () => {
    await handleCopilot({ request: makeRequest(validBody) })

    expect(mockRunAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        role: 'copilot_qa',
        surface: 'copilot',
      })
    )
    const input = mockRunAssistantTurn.mock.calls[0][0]
    expect(input).not.toHaveProperty('simulate')
    expect(input).not.toHaveProperty('askerActor')
    expect(input).not.toHaveProperty('writeToolPolicy')
    expect(input).not.toHaveProperty('copilotIntent')
  })

  it('attributes the turn to the asking teammate for the Copilot usage report', async () => {
    await handleCopilot({ request: makeRequest(validBody) })

    expect(mockRunAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({ actorPrincipalId: 'principal_1' })
    )
  })

  it('uses the resolved actor only for the viewability gate, not as runtime policy input', async () => {
    const resolvedActor = {
      principalId: 'principal_1',
      permissions: new Set(['conversation.set_attributes']),
    }
    mockPolicyActorFromAuth.mockResolvedValue(resolvedActor)

    await handleCopilot({ request: makeRequest(validBody) })

    expect(mockAssertConversationViewable).toHaveBeenCalledWith(CONVERSATION_ID, resolvedActor)
    expect(mockRunAssistantTurn.mock.calls[0][0]).not.toHaveProperty('askerActor')
  })

  it('relays a turn that proposed a write-tool action: the pending action surfaces on the final payload untouched', async () => {
    mockRunAssistantTurn.mockResolvedValue({
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
    })

    const res = await handleCopilot({ request: makeRequest(validBody) })
    const frames = parseSse(await res.text())

    expect(frames.at(-1)).toEqual({
      event: 'copilot.v1.final',
      data: {
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
      },
    })
  })

  it('maps teammate history to customer-sender turns and copilot history to assistant-sender turns, question last', async () => {
    await handleCopilot({
      request: makeRequest({
        ...validBody,
        history: [
          { role: 'teammate', content: 'earlier question' },
          { role: 'copilot', content: 'earlier answer' },
        ],
      }),
    })

    expect(mockRunAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { sender: 'customer', content: 'earlier question' },
          { sender: 'assistant', content: 'earlier answer' },
          { sender: 'customer', content: 'What is the refund policy?' },
        ],
      })
    )
  })

  it('forwards sourceTypes from the request into the turn', async () => {
    await handleCopilot({
      request: makeRequest({ ...validBody, sourceTypes: ['article', 'snippet'] }),
    })

    expect(mockRunAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({ sourceTypes: ['article', 'snippet'] })
    )
  })
})

describe('POST /api/admin/assistant/copilot: ticket-scoped (unified inbox §2.9)', () => {
  const ticketBody = { ticketId: TICKET_ID, question: 'What is the refund policy?' }

  it('400s when both conversationId and ticketId are present (exactly one is required)', async () => {
    const res = await handleCopilot({
      request: makeRequest({ ...validBody, ticketId: TICKET_ID }),
    })
    expect(res.status).toBe(400)
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('400s when neither conversationId nor ticketId is present', async () => {
    const res = await handleCopilot({
      request: makeRequest({ question: 'What is the refund policy?' }),
    })
    expect(res.status).toBe(400)
  })

  it('400s on a malformed ticketId', async () => {
    const res = await handleCopilot({
      request: makeRequest({ ...ticketBody, ticketId: 'not-a-typeid' }),
    })
    expect(res.status).toBe(400)
  })

  it('404s when the ticket does not exist (or is not viewable)', async () => {
    mockTicketLookup.mockResolvedValue([])
    const res = await handleCopilot({ request: makeRequest(ticketBody) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('TICKET_NOT_FOUND')
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('calls the runtime with the ticketId and explicit Copilot Q&A boundary', async () => {
    const res = await handleCopilot({ request: makeRequest(ticketBody) })
    expect(res.status).toBe(200)

    expect(mockRunAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: null,
        ticketId: TICKET_ID,
        role: 'copilot_qa',
        surface: 'copilot',
      })
    )
    // The conversation-viewable gate is never consulted for a ticket-scoped request.
    expect(mockAssertConversationViewable).not.toHaveBeenCalled()
  })

  it('conversation-scoped payloads are unaffected: the ticket lookup is never consulted', async () => {
    await handleCopilot({ request: makeRequest(validBody) })
    expect(mockTicketLookup).not.toHaveBeenCalled()
    expect(mockRunAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONVERSATION_ID, ticketId: null })
    )
  })
})
