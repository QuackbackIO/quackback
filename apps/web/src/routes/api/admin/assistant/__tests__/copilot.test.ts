/**
 * Unit tests for POST /api/admin/assistant/copilot: the permission gate, the
 * flag gate, the AI-configured/budget gates, the conversation-exists gate,
 * the SSE turn stream, and the safety property that matters most: that this
 * route never writes to the conversation (no involvement row, no
 * conversation message, no unread-count change).
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
vi.mock('@/lib/server/domains/assistant', () => ({
  isAssistantConfigured: (...args: unknown[]) => mockIsAssistantConfigured(...args),
  runAssistantTurn: (...args: unknown[]) => mockRunAssistantTurn(...args),
  ensureAssistantPrincipal: (...args: unknown[]) => mockEnsureAssistantPrincipal(...args),
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

import { handleCopilot } from '../copilot'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { NotFoundError } from '@/lib/shared/errors'
import { parseAskAiSseBlock } from '@/components/help-center/ask-ai'
import { generateId } from '@quackback/ids'

const CONVERSATION_ID = generateId('conversation')

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
  mockIsAssistantConfigured.mockReturnValue(true)
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockAssertConversationViewable.mockResolvedValue({ id: CONVERSATION_ID })
  mockEnsureAssistantPrincipal.mockResolvedValue({ id: 'principal_assistant' })
  mockRunAssistantTurn.mockResolvedValue({
    status: 'answered',
    text: 'ok',
    citations: [],
    internalSourced: false,
  })
})

const validBody = { conversationId: CONVERSATION_ID, question: 'What is the refund policy?' }

describe('POST /api/admin/assistant/copilot', () => {
  it('403s when the caller lacks copilot.use', async () => {
    mockRequireAuth.mockRejectedValue(new Error('forbidden'))
    const res = await handleCopilot({ request: makeRequest(validBody) })
    expect(res.status).toBe(403)
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
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

  it('404s when the assistantCopilot flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const res = await handleCopilot({ request: makeRequest(validBody) })
    expect(res.status).toBe(404)
    expect(mockIsAssistantConfigured).not.toHaveBeenCalled()
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
      },
    })
  })

  it('streams a suppressed final payload when the engine mutes Quinn', async () => {
    mockRunAssistantTurn.mockResolvedValue({ status: 'suppressed', reason: 'silence' })

    const res = await handleCopilot({ request: makeRequest(validBody) })
    const frames = parseSse(await res.text())
    expect(frames.at(-1)).toEqual({
      event: 'copilot.v1.final',
      data: { text: '', citations: [], internalSourced: false, suppressed: 'silence' },
    })
  })

  it('calls the runtime directly with a real conversationId, surface copilot, and simulate: true, never the orchestrator (no involvement row, no conversation message, no unread change)', async () => {
    await handleCopilot({ request: makeRequest(validBody) })

    expect(mockRunAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        surface: 'copilot',
        simulate: true,
      })
    )
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
