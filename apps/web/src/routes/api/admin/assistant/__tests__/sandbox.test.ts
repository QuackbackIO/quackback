/**
 * Unit tests for POST /api/admin/assistant/sandbox: auth gate, the AI-configured
 * gate, the AI token budget gate, and the SSE turn stream itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

const mockIsAssistantConfigured = vi.fn()
const mockRunAssistantTurn = vi.fn()
const mockEnsureAssistantPrincipal = vi.fn()
vi.mock('@/lib/server/domains/assistant', () => ({
  isAssistantConfigured: (...args: unknown[]) => mockIsAssistantConfigured(...args),
  runAssistantTurn: (...args: unknown[]) => mockRunAssistantTurn(...args),
  ensureAssistantPrincipal: (...args: unknown[]) => mockEnsureAssistantPrincipal(...args),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

import { handleSandbox } from '../sandbox'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { parseAskAiSseBlock } from '@/components/help-center/ask-ai'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/assistant/sandbox', {
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
  mockIsAssistantConfigured.mockReturnValue(true)
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockEnsureAssistantPrincipal.mockResolvedValue({ id: 'principal_assistant' })
  mockRunAssistantTurn.mockResolvedValue({ status: 'answered', text: 'ok', citations: [] })
})

const validBody = { messages: [{ sender: 'customer', content: 'hi' }] }

describe('POST /api/admin/assistant/sandbox', () => {
  it('403s when the caller lacks settings.manage', async () => {
    mockRequireAuth.mockRejectedValue(new Error('forbidden'))
    const res = await handleSandbox({ request: makeRequest(validBody) })
    expect(res.status).toBe(403)
    expect(mockEnforceAiTokenBudget).not.toHaveBeenCalled()
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('400s on an invalid body', async () => {
    const res = await handleSandbox({ request: makeRequest({ messages: [] }) })
    expect(res.status).toBe(400)
  })

  it('503s when the assistant is not configured', async () => {
    mockIsAssistantConfigured.mockReturnValue(false)
    const res = await handleSandbox({ request: makeRequest(validBody) })
    expect(res.status).toBe(503)
    expect(mockEnforceAiTokenBudget).not.toHaveBeenCalled()
  })

  it('responds with the tier-limit error when the ai token budget is exceeded', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', message: "You've used your AI budget" })
    )
    const res = await handleSandbox({ request: makeRequest(validBody) })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error.code).toBe('TIER_LIMIT_EXCEEDED')
    expect(body.error.message).toBe("You've used your AI budget")
    // No model call: the sandbox never provisions Quinn's identity or streams.
    expect(mockEnsureAssistantPrincipal).not.toHaveBeenCalled()
    expect(mockRunAssistantTurn).not.toHaveBeenCalled()
  })

  it('streams the turn when configured and under budget', async () => {
    mockRunAssistantTurn.mockResolvedValue({
      status: 'answered',
      text: 'Here you go.',
      citations: [],
    })
    const res = await handleSandbox({ request: makeRequest(validBody) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')

    const frames = parseSse(await res.text())
    expect(frames.at(-1)).toEqual({
      event: 'assistant-sandbox.v1.final',
      data: { text: 'Here you go.', citations: [], escalation: null },
    })
  })

  it('defaults the surface to widget when the request omits it', async () => {
    await handleSandbox({ request: makeRequest(validBody) })
    expect(mockRunAssistantTurn).toHaveBeenCalledWith(expect.objectContaining({ surface: 'widget' }))
  })

  it('passes an explicit surface through to the engine', async () => {
    await handleSandbox({ request: makeRequest({ ...validBody, surface: 'email' }) })
    expect(mockRunAssistantTurn).toHaveBeenCalledWith(expect.objectContaining({ surface: 'email' }))
  })

  it('400s on an unknown surface', async () => {
    const res = await handleSandbox({ request: makeRequest({ ...validBody, surface: 'bogus' }) })
    expect(res.status).toBe(400)
  })
})
