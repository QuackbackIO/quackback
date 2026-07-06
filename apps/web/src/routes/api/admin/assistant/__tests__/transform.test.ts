/**
 * Unit tests for POST /api/admin/assistant/transform: the same gate order as
 * copilot.ts (permission -> flag -> AI-configured -> budget ->
 * conversation-viewable), the SSE delta/final stream, and that
 * `runCopilotTransform` is called with the acting teammate's principal id and
 * the exact transform/text from the request, never the conversation's
 * messages (this route only uses the conversation to authorize the caller).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireAuth = vi.fn()
const mockPolicyActorFromAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  policyActorFromAuth: (...args: unknown[]) => mockPolicyActorFromAuth(...args),
}))

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

import { handleTransform } from '../transform'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { NotFoundError } from '@/lib/shared/errors'
import { parseAskAiSseBlock } from '@/components/help-center/ask-ai'
import { generateId } from '@quackback/ids'

const CONVERSATION_ID = generateId('conversation')
const PRINCIPAL_ID = 'principal_1'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/assistant/transform', {
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
  mockRequireAuth.mockResolvedValue({ principal: { id: PRINCIPAL_ID } })
  mockPolicyActorFromAuth.mockResolvedValue({ principalId: PRINCIPAL_ID })
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockIsAssistantConfigured.mockReturnValue(true)
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockAssertConversationViewable.mockResolvedValue({ id: CONVERSATION_ID })
  mockRunCopilotTransform.mockResolvedValue({ text: 'Rewritten.' })
})

const validBody = {
  conversationId: CONVERSATION_ID,
  text: 'Thanks for reaching out, we will look into it.',
  transform: 'more_friendly',
}

describe('POST /api/admin/assistant/transform', () => {
  it('403s when the caller lacks copilot.use', async () => {
    mockRequireAuth.mockRejectedValue(new Error('forbidden'))
    const res = await handleTransform({ request: makeRequest(validBody) })
    expect(res.status).toBe(403)
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
  })

  it('400s on an invalid body (missing text)', async () => {
    const res = await handleTransform({
      request: makeRequest({ conversationId: CONVERSATION_ID, transform: 'more_friendly' }),
    })
    expect(res.status).toBe(400)
  })

  it('400s on an unknown transform kind', async () => {
    const res = await handleTransform({
      request: makeRequest({ ...validBody, transform: 'make_it_pop' }),
    })
    expect(res.status).toBe(400)
  })

  it('400s on text over the char cap', async () => {
    const res = await handleTransform({
      request: makeRequest({ ...validBody, text: 'a'.repeat(8001) }),
    })
    expect(res.status).toBe(400)
  })

  it('400s on a malformed conversationId', async () => {
    const res = await handleTransform({
      request: makeRequest({ ...validBody, conversationId: 'not-a-typeid' }),
    })
    expect(res.status).toBe(400)
  })

  it('404s when the assistantCopilot flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const res = await handleTransform({ request: makeRequest(validBody) })
    expect(res.status).toBe(404)
    expect(mockIsAssistantConfigured).not.toHaveBeenCalled()
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
  })

  it('503s when the assistant is not configured', async () => {
    mockIsAssistantConfigured.mockReturnValue(false)
    const res = await handleTransform({ request: makeRequest(validBody) })
    expect(res.status).toBe(503)
    expect(mockEnforceAiTokenBudget).not.toHaveBeenCalled()
  })

  it('responds with the tier-limit error when the ai token budget is exceeded', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', message: "You've used your AI budget" })
    )
    const res = await handleTransform({ request: makeRequest(validBody) })
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
    const res = await handleTransform({ request: makeRequest(validBody) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('CONVERSATION_NOT_FOUND')
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
  })

  it('streams delta then final with the rewritten text', async () => {
    mockRunCopilotTransform.mockImplementation(
      async (input: { onTextDelta?: (t: string) => void }) => {
        input.onTextDelta?.('Sure')
        input.onTextDelta?.(' thing!')
        return { text: 'Sure thing!' }
      }
    )

    const res = await handleTransform({ request: makeRequest(validBody) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')

    const frames = parseSse(await res.text())
    expect(frames.some((f) => f.event === 'transform.v1.delta')).toBe(true)
    expect(frames.at(-1)).toEqual({
      event: 'transform.v1.final',
      data: { text: 'Sure thing!' },
    })
  })

  it('streams a terminal error when the transform throws', async () => {
    mockRunCopilotTransform.mockRejectedValue(new Error('model exploded'))

    const res = await handleTransform({ request: makeRequest(validBody) })
    const frames = parseSse(await res.text())
    expect(frames.at(-1)).toEqual({
      event: 'transform.v1.error',
      data: { code: 'TRANSFORM_FAILED', message: 'Transform failed' },
    })
  })

  it('calls runCopilotTransform with the acting principal, the transform, and the exact text, never the conversation', async () => {
    await handleTransform({ request: makeRequest(validBody) })

    expect(mockRunCopilotTransform).toHaveBeenCalledWith(
      expect.objectContaining({
        transform: 'more_friendly',
        text: validBody.text,
        principalId: PRINCIPAL_ID,
      })
    )
    expect(mockRunCopilotTransform.mock.calls[0][0]).not.toHaveProperty('conversationId')
  })

  it('uses the conversation only to authorize the caller (assertConversationViewable runs, but the id never reaches the transform)', async () => {
    await handleTransform({ request: makeRequest(validBody) })

    expect(mockAssertConversationViewable).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ principalId: PRINCIPAL_ID })
    )
  })
})
