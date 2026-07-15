/**
 * Unit tests for POST /api/admin/assistant/suggest (QUINN-PROACTIVE-SUGGESTIONS-SPEC.md):
 * the shared copilot gate sequence PLUS the `assistantProactiveSuggestions`
 * flag layer, the targeted pre-turn item read (`loadAssistantItemState`) that
 * backs the closed-item and lastCustomerMessageId-staleness gates (both 409
 * CONFLICT — the client renders nothing for a 409), the FINAL-ONLY SSE stream
 * (no suggest.v1.delta frames, per the contract doc), and the exact
 * `runAssistantTurn` input this route commits to (`role: 'suggested_reply'`,
 * `surface: 'copilot'`, and no messages or caller-owned tool policy: the role
 * owns those invariants inside
 * the runtime). `runAssistantTurn` itself is mocked throughout, mirroring
 * copilot.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireAuth = vi.fn()
const mockPolicyActorFromAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  policyActorFromAuth: (...args: unknown[]) => mockPolicyActorFromAuth(...args),
}))

const mockIsAssistantConfigured = vi.fn()
const mockRunAssistantTurn = vi.fn()
const mockEnsureAssistantPrincipal = vi.fn()
const mockLoadAssistantItemState = vi.fn()
vi.mock('@/lib/server/domains/assistant', () => ({
  isAssistantConfigured: (...args: unknown[]) => mockIsAssistantConfigured(...args),
  runAssistantTurn: (...args: unknown[]) => mockRunAssistantTurn(...args),
  ensureAssistantPrincipal: (...args: unknown[]) => mockEnsureAssistantPrincipal(...args),
  loadAssistantItemState: (...args: unknown[]) => mockLoadAssistantItemState(...args),
}))

// Two distinct flags gate this route: inboxAi (inside
// gateCopilotRequest) and assistantProactiveSuggestions (this route's own
// extra layer). Both default on; individual tests flip one at a time.
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

// `assertTicketVisible` (copilot-gate.ts) runs for real, gated on the same
// db.select chain fake copilot.test.ts uses.
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

import { handleSuggest } from '../suggest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { NotFoundError } from '@/lib/shared/errors'
import { parseAskAiSseBlock } from '@/components/help-center/ask-ai'
import { generateId } from '@quackback/ids'

const CONVERSATION_ID = generateId('conversation')
const TICKET_ID = generateId('ticket')
const LATEST_MESSAGE_ID = generateId('conversation_msg')
const STALE_MESSAGE_ID = generateId('conversation_msg')

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/assistant/suggest', {
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

const SKIP_FINAL_FRAME = {
  event: 'suggest.v1.final',
  data: { text: '', citations: [], internalSourced: false, skip: true },
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
  mockLoadAssistantItemState.mockResolvedValue({
    closed: false,
    latestCustomerMessageId: LATEST_MESSAGE_ID,
  })
  mockRunAssistantTurn.mockResolvedValue({
    status: 'answered',
    text: 'Here is a draft reply.',
    citations: [],
    internalSourced: false,
    proposedActions: [],
    answerType: 'draft_reply',
    skip: false,
  })
})

const validBody = { conversationId: CONVERSATION_ID, lastCustomerMessageId: LATEST_MESSAGE_ID }

describe('POST /api/admin/assistant/suggest', () => {
  it('403s when the caller lacks copilot.use', async () => {
    mockRequireAuth.mockRejectedValue(
      new Error("Access denied: Requires permission 'copilot.use', role member lacks it")
    )
    const res = await handleSuggest({ request: makeRequest(validBody) })
    expect(res.status).toBe(403)
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('400s on an invalid body (missing lastCustomerMessageId)', async () => {
    const res = await handleSuggest({ request: makeRequest({ conversationId: CONVERSATION_ID }) })
    expect(res.status).toBe(400)
  })

  it('400s on a malformed lastCustomerMessageId', async () => {
    const res = await handleSuggest({
      request: makeRequest({ ...validBody, lastCustomerMessageId: 'not-a-typeid' }),
    })
    expect(res.status).toBe(400)
  })

  it('404s when the inboxAi flag is off (the shared gate)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const res = await handleSuggest({ request: makeRequest(validBody) })
    expect(res.status).toBe(404)
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('404s when inboxAi is on but assistantProactiveSuggestions is off (the extra gate layer)', async () => {
    mockIsFeatureEnabled.mockImplementation(async (flag: string) => flag === 'inboxAi')
    const res = await handleSuggest({ request: makeRequest(validBody) })
    expect(res.status).toBe(404)
    expect(mockLoadAssistantItemState).not.toHaveBeenCalled()
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('404s when the suggestedReplies capability is off (v3 config gate)', async () => {
    mockIsCopilotCapabilityEnabled.mockResolvedValue(false)
    const res = await handleSuggest({ request: makeRequest(validBody) })
    expect(res.status).toBe(404)
    expect(mockLoadAssistantItemState).not.toHaveBeenCalled()
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('503s when the assistant is not configured', async () => {
    mockIsAssistantConfigured.mockReturnValue(false)
    const res = await handleSuggest({ request: makeRequest(validBody) })
    expect(res.status).toBe(503)
  })

  it('responds with the tier-limit error when the ai token budget is exceeded', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', message: "You've used your AI budget" })
    )
    const res = await handleSuggest({ request: makeRequest(validBody) })
    expect(res.status).toBe(402)
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('404s when the conversation does not exist (or is not viewable)', async () => {
    mockAssertConversationViewable.mockRejectedValue(
      new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
    )
    const res = await handleSuggest({ request: makeRequest(validBody) })
    expect(res.status).toBe(404)
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('409s when lastCustomerMessageId is stale (a newer customer message now exists)', async () => {
    const res = await handleSuggest({
      request: makeRequest({ ...validBody, lastCustomerMessageId: STALE_MESSAGE_ID }),
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('CONFLICT')
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('409s when the item has no customer message at all', async () => {
    mockLoadAssistantItemState.mockResolvedValue({ closed: false, latestCustomerMessageId: null })
    const res = await handleSuggest({ request: makeRequest(validBody) })
    expect(res.status).toBe(409)
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('409s on a CLOSED conversation without spending a turn, even when lastCustomerMessageId matches', async () => {
    // A closed conversation's latest message is typically the customer's
    // thank-you; drafting for it would burn a paid turn per teammate who
    // dwells. 409 (not a skip final) so the client's existing conflict
    // mapping renders nothing.
    mockLoadAssistantItemState.mockResolvedValue({
      closed: true,
      latestCustomerMessageId: LATEST_MESSAGE_ID,
    })
    const res = await handleSuggest({ request: makeRequest(validBody) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('CONFLICT')
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('409s when the item row vanished between the viewability gate and the pre-turn read (defensive)', async () => {
    mockLoadAssistantItemState.mockResolvedValue(null)
    const res = await handleSuggest({ request: makeRequest(validBody) })
    expect(res.status).toBe(409)
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('reads the item state through the targeted pre-turn read, never a full thread load', async () => {
    await handleSuggest({ request: makeRequest(validBody) })
    expect(mockLoadAssistantItemState).toHaveBeenCalledWith(CONVERSATION_ID, null)
  })

  it('calls the runtime with the explicit suggested-reply boundary and no messages', async () => {
    await handleSuggest({ request: makeRequest(validBody) })

    expect(mockRunAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        role: 'suggested_reply',
        surface: 'copilot',
        latestCustomerMessageId: LATEST_MESSAGE_ID,
      })
    )
    // The suggestion invariants live on the intent (COPILOT_INTENT_PROFILES,
    // assistant.runtime.ts), not on this caller — pinned there, absent here.
    const input = mockRunAssistantTurn.mock.calls[0][0]
    expect(input).not.toHaveProperty('writeToolPolicy')
    expect(input).not.toHaveProperty('copilotIntent')
    expect(input).not.toHaveProperty('askerActor')
    expect(input).not.toHaveProperty('messages')
    expect(input).not.toHaveProperty('onTextDelta')
  })

  it('attributes the turn to the viewing teammate without threading the gate actor', async () => {
    const resolvedActor = { principalId: 'principal_1' }
    mockPolicyActorFromAuth.mockResolvedValue(resolvedActor)

    await handleSuggest({ request: makeRequest(validBody) })

    expect(mockRunAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({ actorPrincipalId: 'principal_1' })
    )
    expect(mockAssertConversationViewable).toHaveBeenCalledWith(CONVERSATION_ID, resolvedActor)
    expect(mockRunAssistantTurn.mock.calls[0][0]).not.toHaveProperty('askerActor')
  })

  it('streams the final frame ONLY: no suggest.v1.delta frames, per the final-only contract', async () => {
    mockRunAssistantTurn.mockImplementation(
      async (input: { onTextDelta?: (t: string) => void }) => {
        // Even a runtime that WOULD stream has nowhere to send deltas: the
        // route wires no onTextDelta (a skip is only knowable at the end of
        // the run, so streamed text would be a guess dressed up as a draft).
        input.onTextDelta?.('Here')
        input.onTextDelta?.(' is a draft.')
        return {
          status: 'answered',
          text: 'Here is a draft.',
          citations: [{ type: 'article', id: 'kb_article_1', title: 'T', url: '/u' }],
          internalSourced: false,
          proposedActions: [],
          answerType: 'draft_reply',
          skip: false,
        }
      }
    )

    const res = await handleSuggest({ request: makeRequest(validBody) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')

    const frames = parseSse(await res.text())
    expect(frames.some((f) => f.event === 'suggest.v1.delta')).toBe(false)
    expect(frames).toEqual([
      {
        event: 'suggest.v1.final',
        data: {
          text: 'Here is a draft.',
          citations: [{ type: 'article', id: 'kb_article_1', title: 'T', url: '/u' }],
          internalSourced: false,
        },
      },
    ])
  })

  it('streams a skip final payload (empty card) for a tool-derived honest miss', async () => {
    mockRunAssistantTurn.mockResolvedValue({
      status: 'answered',
      text: 'Would have been a guess.',
      citations: [],
      internalSourced: false,
      proposedActions: [],
      answerType: 'draft_reply',
      skip: true,
    })

    const res = await handleSuggest({ request: makeRequest(validBody) })
    const frames = parseSse(await res.text())
    expect(frames.at(-1)).toEqual(SKIP_FINAL_FRAME)
  })

  it('maps a done-but-EMPTY final text to a skip so a malformed result cannot render a bare card', async () => {
    mockRunAssistantTurn.mockResolvedValue({
      status: 'answered',
      text: '',
      citations: [],
      internalSourced: false,
      proposedActions: [],
      answerType: 'draft_reply',
      skip: false,
    })

    const res = await handleSuggest({ request: makeRequest(validBody) })
    const frames = parseSse(await res.text())
    expect(frames.at(-1)).toEqual(SKIP_FINAL_FRAME)
  })

  it('maps whitespace-only final text to a skip too (trim, not truthiness)', async () => {
    mockRunAssistantTurn.mockResolvedValue({
      status: 'answered',
      text: '  \n ',
      citations: [],
      internalSourced: false,
      proposedActions: [],
      answerType: 'draft_reply',
      skip: false,
    })

    const res = await handleSuggest({ request: makeRequest(validBody) })
    const frames = parseSse(await res.text())
    expect(frames.at(-1)).toEqual(SKIP_FINAL_FRAME)
  })

  it('streams a skip final payload when the engine mutes Quinn (defensive; the intent-owned turn messages never carry human_agent)', async () => {
    mockRunAssistantTurn.mockResolvedValue({ status: 'suppressed', reason: 'silence' })

    const res = await handleSuggest({ request: makeRequest(validBody) })
    const frames = parseSse(await res.text())
    expect(frames.at(-1)).toEqual(SKIP_FINAL_FRAME)
  })
})

describe('POST /api/admin/assistant/suggest: ticket-scoped (unified inbox §2.9)', () => {
  const ticketBody = { ticketId: TICKET_ID, lastCustomerMessageId: LATEST_MESSAGE_ID }

  it('resolves the item state off the ticket ref and threads ticketId into the turn', async () => {
    const res = await handleSuggest({ request: makeRequest(ticketBody) })
    expect(res.status).toBe(200)
    expect(mockLoadAssistantItemState).toHaveBeenCalledWith(null, TICKET_ID)
    expect(mockRunAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: null,
        ticketId: TICKET_ID,
        role: 'suggested_reply',
        surface: 'copilot',
      })
    )
  })

  it('409s on a ticket whose status category is closed', async () => {
    mockLoadAssistantItemState.mockResolvedValue({
      closed: true,
      latestCustomerMessageId: LATEST_MESSAGE_ID,
    })
    const res = await handleSuggest({ request: makeRequest(ticketBody) })
    expect(res.status).toBe(409)
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('404s when the ticket does not exist (or is not viewable)', async () => {
    mockTicketLookup.mockResolvedValue([])
    const res = await handleSuggest({ request: makeRequest(ticketBody) })
    expect(res.status).toBe(404)
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })
})
