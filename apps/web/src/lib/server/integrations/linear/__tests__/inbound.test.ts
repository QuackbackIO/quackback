/**
 * Tests for Linear inbound webhook handler.
 */

import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { linearInboundHandler } from '../inbound'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/webhook', { headers })
}

function stateChangePayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'Issue',
    action: 'update',
    updatedFrom: { stateId: 'old-state-id' },
    data: {
      id: 'uuid-issue-123',
      identifier: 'QUA-42',
      state: { name: 'Done' },
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

describe('linearInboundHandler.verifySignature', () => {
  const secret = 'webhook-secret'
  const body = '{"test": true}'

  it('returns true for valid signature', async () => {
    const sig = sign(body, secret)
    const req = makeRequest({ 'Linear-Signature': sig })
    const result = await linearInboundHandler.verifySignature(req, body, secret)
    expect(result).toBe(true)
  })

  it('returns 401 when signature header is missing', async () => {
    const req = makeRequest()
    const result = await linearInboundHandler.verifySignature(req, body, secret)
    expect(result).not.toBe(true)
    expect((result as Response).status).toBe(401)
  })

  it('returns 401 for invalid signature', async () => {
    const req = makeRequest({ 'Linear-Signature': 'bad-sig' })
    const result = await linearInboundHandler.verifySignature(req, body, secret)
    expect(result).not.toBe(true)
    expect((result as Response).status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Status change parsing
// ---------------------------------------------------------------------------

describe('linearInboundHandler.parseStatusChange', () => {
  it('parses a state change event and returns UUID as externalId', async () => {
    const payload = stateChangePayload()
    const result = await linearInboundHandler.parseStatusChange(JSON.stringify(payload), {}, {})

    expect(result).toEqual({
      externalId: 'uuid-issue-123',
      externalStatus: 'Done',
      eventType: 'issue.state_changed',
    })
  })

  it('returns null for non-Issue types', async () => {
    const payload = stateChangePayload({ type: 'Comment' })
    const result = await linearInboundHandler.parseStatusChange(JSON.stringify(payload), {}, {})
    expect(result).toBeNull()
  })

  it('returns null for non-update actions', async () => {
    const payload = stateChangePayload({ action: 'create' })
    const result = await linearInboundHandler.parseStatusChange(JSON.stringify(payload), {}, {})
    expect(result).toBeNull()
  })

  it('returns null when updatedFrom has no stateId', async () => {
    const payload = stateChangePayload({ updatedFrom: {} })
    const result = await linearInboundHandler.parseStatusChange(JSON.stringify(payload), {}, {})
    expect(result).toBeNull()
  })

  it('returns null when state name is missing', async () => {
    const payload = stateChangePayload()
    ;(payload.data as Record<string, unknown>).state = {}
    const result = await linearInboundHandler.parseStatusChange(JSON.stringify(payload), {}, {})
    expect(result).toBeNull()
  })
})
