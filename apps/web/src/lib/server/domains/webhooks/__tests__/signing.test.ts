/**
 * The secret a workflow webhook is signed with is derived, never stored, so a
 * receiver's setup depends on the derivation staying put: the expected value
 * for one URL is pinned rather than recomputed the way the code computes it
 * (HMAC-SHA256 of the URL under the HKDF key for 'workflow-webhook-signing').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('@/lib/server/config', () => ({
  config: { secretKey: 'test-secret-key-for-workflow-webhooks' },
}))

const { webhookSignatureHeaders, workflowWebhookSecret } = await import('../signing')
const { _resetKeyCache } = await import('@/lib/server/encryption')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

beforeEach(() => {
  _resetKeyCache()
})

describe('workflowWebhookSecret', () => {
  it('is the pinned secret for a URL, in the outgoing webhook secret form', () => {
    expect(workflowWebhookSecret('https://hooks.example.com/quackback')).toBe(
      'whsec_necuXznGSXtvdJrBW1g6ynekJusGQG0wQcKG16vjBMA'
    )
  })

  it('gives each URL its own secret, so no receiver can sign as another', () => {
    const a = workflowWebhookSecret('https://hooks.example.com/a')
    const b = workflowWebhookSecret('https://hooks.example.com/b')
    expect(a).not.toBe(b)
    expect(workflowWebhookSecret('https://hooks.example.com/a')).toBe(a)
  })

  it('differs between workspaces for the same URL', () => {
    const url = 'https://hooks.example.com/shared'
    const alpha = withWorkspace('workspace-alpha', () => workflowWebhookSecret(url))
    const beta = withWorkspace('workspace-beta', () => workflowWebhookSecret(url))
    expect(alpha).not.toBe(beta)
    expect(alpha).not.toBe(workflowWebhookSecret(url))
  })
})

describe('webhookSignatureHeaders', () => {
  it('signs "<timestamp>.<body>" with HMAC-SHA256 under the secret', () => {
    const at = new Date('2026-11-19T12:00:00Z')
    const headers = webhookSignatureHeaders('whsec_abc', '{"id":"evt_1"}', at)
    const timestamp = String(at.getTime() / 1000)
    expect(headers['X-Quackback-Timestamp']).toBe(timestamp)
    const expected = createHmac('sha256', 'whsec_abc')
      .update(`${timestamp}.{"id":"evt_1"}`)
      .digest('hex')
    expect(headers['X-Quackback-Signature']).toBe(`sha256=${expected}`)
  })
})
