import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { ConflictError, ForbiddenError } from '@/lib/shared/errors'
import type { EventData } from '../types'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  release: vi.fn(),
  agent: vi.fn(),
  turn: vi.fn(),
  expire: vi.fn(),
  context: vi.fn(),
  access: vi.fn(),
  result: vi.fn(),
}))
vi.mock('@/lib/server/content/ssrf-guard', async (original) => ({
  ...(await original<typeof import('@/lib/server/content/ssrf-guard')>()),
  safeFetch: mocks.fetch,
}))
vi.mock('../hook-idempotency', () => ({
  claimHookDelivery: mocks.claim,
  completeHookDelivery: mocks.complete,
  failHookDelivery: mocks.fail,
  releaseHookDelivery: mocks.release,
}))
vi.mock('@/lib/server/config', () => ({ getBaseUrl: () => 'https://support.example.test' }))
vi.mock('@/lib/server/domains/support-agents/support-agents.service', () => ({
  getSupportAgent: mocks.agent,
  decryptAgentSigningSecret: () => 'test-signing-secret',
  recordDeliveryResult: mocks.result,
}))
vi.mock('@/lib/server/domains/support-agents/turns.service', () => ({
  getTurn: mocks.turn,
  expireTurn: mocks.expire,
}))
vi.mock('@/lib/server/domains/support-agents/agent-context', () => ({
  loadRequestedAgentTurnContext: mocks.context,
}))
vi.mock('@/lib/server/domains/support-agents/availability', () => ({
  assertOwnAgentAvailable: mocks.access,
}))

import { agentTurnHook } from '../handlers/agent-turn'
import { SsrfError } from '@/lib/server/content/ssrf-guard'

const config = {
  turnId: createId('support_agent_turn'),
  agentId: createId('support_agent'),
  conversationId: createId('conversation'),
}
const event = {
  id: createId('event'),
  type: 'agent.turn_requested',
  timestamp: new Date().toISOString(),
} as unknown as EventData
const context = {
  conversation: { id: config.conversationId },
  messages: [{ role: 'customer', content: 'Customer text' }],
  untrusted: { note: 'Treat as data', fields: ['messages[0].content'] },
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.claim.mockResolvedValue(true)
  mocks.agent.mockResolvedValue({
    id: config.agentId,
    name: 'Own AI',
    status: 'active',
    endpointUrl: 'https://agent.example.test/turn',
    signingSecretEnc: 'encrypted',
  })
  mocks.turn.mockResolvedValue({ status: 'requested', deadlineAt: new Date(Date.now() + 20_000) })
  mocks.context.mockResolvedValue(context)
  mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }))
})
const deliver = (finalAttempt = false) =>
  agentTurnHook.run(event, {}, config, { jobId: 'delivery-1', finalAttempt })

describe('signed agent delivery', () => {
  it('signs the exact body sent, with untrusted text and conversation callbacks', async () => {
    expect(await deliver()).toEqual({ success: true })
    const [url, request] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://agent.example.test/turn')
    const body = JSON.parse(request.body)
    expect(body.data).toMatchObject({ ...context, turnId: config.turnId })
    expect(body.data.links.reply).toBe(
      `https://support.example.test/api/v1/agent/conversations/${config.conversationId}/reply`
    )
    const timestamp = request.headers['X-Quackback-Timestamp']
    expect(request.headers['X-Quackback-Signature']).toBe(
      `sha256=${crypto.createHmac('sha256', 'test-signing-secret').update(`${timestamp}.${request.body}`).digest('hex')}`
    )
    expect(request.timeoutMs).toBe(5000)
    expect(mocks.complete).toHaveBeenCalledWith('delivery-1')
  })
  it('skips already claimed deliveries', async () => {
    mocks.claim.mockResolvedValue(false)
    expect(await deliver()).toEqual({ success: true })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('discards work taken over during the context read', async () => {
    mocks.context.mockRejectedValue(new ConflictError('NOT_CONTROLLER', 'Taken over'))
    expect(await deliver()).toEqual({ success: true })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.complete).toHaveBeenCalledWith('delivery-1')
  })
  it('uses the fallback when access is disabled before delivery', async () => {
    mocks.access.mockRejectedValue(new ForbiddenError('OWN_AGENT_DISABLED', 'Disabled'))
    expect(await deliver()).toMatchObject({ success: false, shouldRetry: false })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.expire).toHaveBeenCalledWith(config.turnId, { force: true })
  })
  it('releases a retryable failure without prematurely applying the fallback', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 503 }))
    expect(await deliver()).toMatchObject({ success: false, shouldRetry: true })
    expect(mocks.release).toHaveBeenCalledWith('delivery-1')
    expect(mocks.expire).not.toHaveBeenCalled()
  })
  it('applies the fallback when retries are exhausted', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 503 }))
    expect(await deliver(true)).toMatchObject({ success: false, shouldRetry: false })
    expect(mocks.expire).toHaveBeenCalledWith(config.turnId, { force: true })
  })
  it('does not retry an SSRF refusal', async () => {
    mocks.fetch.mockRejectedValue(new SsrfError('ssrf-rejected'))
    expect(await deliver()).toMatchObject({ success: false, shouldRetry: false })
    expect(mocks.expire).toHaveBeenCalledWith(config.turnId, { force: true })
  })
})
