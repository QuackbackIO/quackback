/**
 * Unit tests for POST /api/admin/assistant/test: the `assistant.manage`
 * permission gate, the direct AG-UI body parse (no item ref — the sandbox is
 * unscoped), the AI-configured/budget gates, the exact `streamAssistantTurn`
 * input this route commits to (`conversationId: null`, `simulate: true`, the
 * per-agent role/surface fan-out), and the client-safe final-payload allowlist
 * (hidden prompts, instructions, reasoning, tool args/results never crossing
 * the boundary). `streamAssistantTurn` is mocked throughout — its wire
 * mechanics are pinned in assistant.runtime.test.ts; these tests pin what THIS
 * route does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequireAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

const mockIsAssistantConfigured = vi.fn()
const mockStreamAssistantTurn = vi.fn()
const mockEnsureAssistantPrincipal = vi.fn()
vi.mock('@/lib/server/domains/assistant', () => ({
  isAssistantConfigured: (...args: unknown[]) => mockIsAssistantConfigured(...args),
  streamAssistantTurn: (...args: unknown[]) => mockStreamAssistantTurn(...args),
  ensureAssistantPrincipal: (...args: unknown[]) => mockEnsureAssistantPrincipal(...args),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

import { handleTestAgent } from '../test'
import type { StreamAssistantTurnOptions } from '@/lib/server/domains/assistant/assistant.runtime'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { PERMISSIONS } from '@/lib/shared/permissions'

/** Build an AG-UI RunAgentInput body: the test thread as messages, the two
 *  sandbox selectors on forwardedProps. */
function aguiBody(options: {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  forwardedProps?: Record<string, unknown>
}): Record<string, unknown> {
  return {
    threadId: 'thread-test',
    runId: 'run-test',
    messages: (options.messages ?? [{ role: 'user', content: 'Can you help?' }]).map((m, i) => ({
      id: `m${i}`,
      ...m,
    })),
    tools: [],
    context: [],
    state: {},
    forwardedProps: options.forwardedProps ?? {},
  }
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/admin/assistant/test', {
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

const safeTrace = {
  promptVersion: 'support-agent-v4',
  configRevision: 7,
  role: 'customer_support',
  tone: 'balanced',
  responseLength: 'brief',
  appliedGuidance: [{ id: 'guidance_1', name: 'Refund policy' }],
  toolCalls: [
    { name: 'search', outcome: 'read' },
    { name: 'create_ticket', outcome: 'simulated' },
  ],
}

/** The turn result the mocked streamAssistantTurn maps through the route's
 *  buildFinalPayload — set per test to exercise the allowlist. */
let nextTurnResult: unknown

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  mockIsAssistantConfigured.mockReturnValue(true)
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockEnsureAssistantPrincipal.mockResolvedValue({ id: 'principal_assistant' })
  nextTurnResult = {
    status: 'answered',
    text: 'I can help.',
    citations: [],
    escalation: undefined,
    trace: safeTrace,
  }
  mockStreamAssistantTurn.mockImplementation((options: StreamAssistantTurnOptions) =>
    (async function* () {
      yield { type: 'RUN_STARTED', ...options.wire }
      yield {
        type: 'RUN_FINISHED',
        ...options.wire,
        finishReason: 'stop',
        result: options.buildFinalPayload(nextTurnResult as never),
      }
    })()
  )
})

/** The turn input the route handed to streamAssistantTurn. */
function turnInput(): Record<string, unknown> {
  return (mockStreamAssistantTurn.mock.calls[0][0] as StreamAssistantTurnOptions)
    .input as unknown as Record<string, unknown>
}

describe('POST /api/admin/assistant/test', () => {
  it('requires assistant.manage and maps genuine denial to 403', async () => {
    mockRequireAuth.mockRejectedValue(
      new Error("Access denied: Requires permission 'assistant.manage', role member lacks it")
    )
    const response = await handleTestAgent({ request: request(aguiBody({})) })
    expect(response.status).toBe(403)
    expect(mockRequireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('does not disguise auth infrastructure failures as permission denial', async () => {
    mockRequireAuth.mockRejectedValue(new Error('session store unavailable'))
    await expect(handleTestAgent({ request: request(aguiBody({})) })).rejects.toThrow(
      'session store unavailable'
    )
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('400s on a non-AG-UI body', async () => {
    const response = await handleTestAgent({
      request: request({ messages: [{ sender: 'customer', content: 'hi' }] }),
    })
    expect(response.status).toBe(400)
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('400s when the thread does not end on a customer message', async () => {
    const response = await handleTestAgent({
      request: request(aguiBody({ messages: [{ role: 'assistant', content: 'Previous reply' }] })),
    })
    expect(response.status).toBe(400)
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('checks that an assistant model is configured before spending budget', async () => {
    mockIsAssistantConfigured.mockReturnValue(false)
    const response = await handleTestAgent({ request: request(aguiBody({})) })
    expect(response.status).toBe(503)
    expect(mockEnforceAiTokenBudget).not.toHaveBeenCalled()
  })

  it('returns the complete structured AI budget error without starting a turn', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({
        limit: 'aiTokensPerMonth',
        message: 'Monthly AI token budget reached',
        current: 1_000,
        max: 1_000,
      })
    )
    const response = await handleTestAgent({ request: request(aguiBody({})) })
    expect(response.status).toBe(402)
    expect(await response.json()).toEqual({
      error: 'tier_limit_exceeded',
      limit: 'aiTokensPerMonth',
      message: 'Monthly AI token budget reached',
      current: 1_000,
      max: 1_000,
    })
    expect(mockEnsureAssistantPrincipal).not.toHaveBeenCalled()
    expect(mockStreamAssistantTurn).not.toHaveBeenCalled()
  })

  it('uses the exact production turn seam in explicit no-write simulation mode', async () => {
    const response = await handleTestAgent({ request: request(aguiBody({})) })
    await response.text()

    expect(turnInput()).toMatchObject({
      messages: [{ sender: 'customer', content: 'Can you help?' }],
      assistantPrincipalId: 'principal_assistant',
      conversationId: null,
      role: 'customer_support',
      surface: 'widget',
      simulate: true,
    })
    const input = turnInput()
    expect(input).not.toHaveProperty('ticketId')
    expect(input).not.toHaveProperty('involvementId')
    expect(input).not.toHaveProperty('latestCustomerMessageId')
    expect(input).not.toHaveProperty('askerActor')
    expect(input).not.toHaveProperty('writeToolPolicy')
  })

  it('accepts only the live customer channel vocabulary and defaults to widget', async () => {
    const email = await handleTestAgent({
      request: request(aguiBody({ forwardedProps: { channel: 'email' } })),
    })
    await email.text()
    expect(turnInput()).toMatchObject({ role: 'customer_support', surface: 'email' })

    const invalid = await handleTestAgent({
      request: request(aguiBody({ forwardedProps: { channel: 'copilot' } })),
    })
    expect(invalid.status).toBe(400)
  })

  it('runs the copilot agent on the copilot surface and omits voice presets', async () => {
    nextTurnResult = {
      status: 'answered',
      text: 'Here is what I found.',
      citations: [],
      escalation: undefined,
      trace: {
        promptVersion: 'support-agent-v4',
        configRevision: 7,
        role: 'copilot_qa',
        appliedGuidance: [],
        toolCalls: [{ name: 'search', outcome: 'read' }],
      },
    }

    const response = await handleTestAgent({
      request: request(aguiBody({ forwardedProps: { agent: 'copilot' } })),
    })
    const chunks = parseAguiSse(await response.text())

    expect(turnInput()).toMatchObject({
      role: 'copilot_qa',
      surface: 'copilot',
      conversationId: null,
      simulate: true,
      actorPrincipalId: 'principal_admin',
    })
    const finished = chunks.at(-1) as { result?: { trace: Record<string, unknown> } }
    expect(finished.result?.trace).toMatchObject({ role: 'copilot_qa' })
    expect(finished.result?.trace).not.toHaveProperty('tone')
    expect(finished.result?.trace).not.toHaveProperty('responseLength')
  })

  it('builds an exactly allowlisted final trace with no hidden fields on the wire', async () => {
    nextTurnResult = {
      status: 'answered',
      text: 'I can help. [1]',
      citations: [
        {
          type: 'article',
          id: 'article_1',
          title: 'Refunds',
          url: '/hc/refunds',
          internal: true,
          updatedAt: '2026-07-01T00:00:00.000Z',
          rawResult: 'private result',
        },
      ],
      escalation: {
        reason: 'explicit_request',
        mode: 'handoff',
        customerNeed: 'private packet',
        attempted: ['private reasoning'],
        recommendedNextStep: 'private instruction',
      },
      trace: {
        ...safeTrace,
        configFallbackReason: 'database_read_failed',
        rawPrompt: 'hidden prompt',
        appliedGuidance: [
          { id: 'guidance_1', name: 'Refund policy', instruction: 'hidden instruction' },
        ],
        toolCalls: [
          {
            name: 'search',
            outcome: 'read',
            args: { query: 'secret' },
            result: 'private result',
          },
          { name: 'create_ticket', outcome: 'simulated', args: { body: 'secret' } },
        ],
      },
    }

    const response = await handleTestAgent({ request: request(aguiBody({})) })
    const text = await response.text()
    const chunks = parseAguiSse(text)
    const finished = chunks.at(-1) as { type: string; result?: unknown }

    expect(finished).toMatchObject({ type: 'RUN_FINISHED' })
    expect(finished.result).toEqual({
      text: 'I can help. [1]',
      citations: [{ type: 'article', id: 'article_1', title: 'Refunds', url: '/hc/refunds' }],
      escalation: { reason: 'explicit_request', mode: 'handoff' },
      trace: safeTrace,
    })
    expect(text).not.toContain('hidden prompt')
    expect(text).not.toContain('hidden instruction')
    expect(text).not.toContain('private')
    expect(text).not.toContain('"args"')
    // `result` is now the AG-UI RUN_FINISHED envelope slot, so it can't be a
    // banned substring; the exact `toEqual` above already pins toolCalls to
    // `{ name, outcome }` (no tool-call `result` field), and `private` covers
    // the leaked value itself.
  })
})
