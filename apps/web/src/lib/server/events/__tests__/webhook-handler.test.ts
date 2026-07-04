/**
 * Webhook Handler Unit Tests
 *
 * Tests for webhook delivery logic including:
 * - HMAC signature generation
 * - SSRF protection (private IP blocking)
 * - Request timeout handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const h = vi.hoisted(() => ({ safeFetch: vi.fn(), claim: vi.fn(async () => true) }))

// Mock the db import before importing the handler
vi.mock('@/lib/server/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
  webhooks: { id: 'id', failureCount: 'failureCount', status: 'status' },
  eq: vi.fn(),
  sql: vi.fn(),
}))

// Keep the real SsrfError/TimeoutError classes (instanceof drives retry
// classification); mock only the network call + the idempotency claim.
vi.mock('@/lib/server/content/ssrf-guard', async (orig) => {
  const actual = await orig<typeof import('@/lib/server/content/ssrf-guard')>()
  return { ...actual, safeFetch: (...a: unknown[]) => h.safeFetch(...a) }
})
vi.mock('../hook-idempotency', () => ({ claimHookDelivery: (...a: unknown[]) => h.claim(...a) }))

import { webhookHook } from '../handlers/webhook'
import { SsrfError, TimeoutError } from '@/lib/server/content/ssrf-guard'

describe('Webhook Handler', () => {
  describe('HMAC Signature Generation', () => {
    it('generates correct HMAC-SHA256 signature', () => {
      const secret = 'test_secret_key'
      const timestamp = 1700000000
      const payload = JSON.stringify({ test: 'data' })

      const signaturePayload = `${timestamp}.${payload}`
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signaturePayload)
        .digest('hex')

      expect(expectedSignature).toMatch(/^[a-f0-9]{64}$/)
    })

    it('produces different signatures for different secrets', () => {
      const timestamp = 1700000000
      const payload = JSON.stringify({ test: 'data' })

      const sig1 = crypto
        .createHmac('sha256', 'secret1')
        .update(`${timestamp}.${payload}`)
        .digest('hex')

      const sig2 = crypto
        .createHmac('sha256', 'secret2')
        .update(`${timestamp}.${payload}`)
        .digest('hex')

      expect(sig1).not.toBe(sig2)
    })

    it('produces different signatures for different payloads', () => {
      const secret = 'test_secret'
      const timestamp = 1700000000

      const sig1 = crypto.createHmac('sha256', secret).update(`${timestamp}.{"a":1}`).digest('hex')

      const sig2 = crypto.createHmac('sha256', secret).update(`${timestamp}.{"a":2}`).digest('hex')

      expect(sig1).not.toBe(sig2)
    })
  })

  // SSRF protection is now delegated to the central safeFetch guard (it validates
  // the host + pins the connection to the validated IP, closing the TOCTOU the
  // old per-handler dns pre-check left open). These exercise the real run() path.
  describe('SSRF-safe delivery via safeFetch', () => {
    const event = {
      id: 'evt_1',
      type: 'post.created',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user' },
      data: { post: { id: 'post_1' } },
    } as never
    const target = { url: 'https://hooks.example.com/deliver' }
    const config = { secret: 'whsec_test', webhookId: 'webhook_1' }
    const resp = (status: number): Response =>
      ({ ok: status >= 200 && status < 300, status }) as Response

    beforeEach(() => {
      vi.clearAllMocks()
      h.claim.mockResolvedValue(true)
    })

    it('delivers through safeFetch (POST + signed headers), succeeding on 2xx', async () => {
      h.safeFetch.mockResolvedValue(resp(200))
      const res = await webhookHook.run!(event, target, config)
      expect(res.success).toBe(true)

      const [url, init] = h.safeFetch.mock.calls[0]
      expect(url).toBe(target.url)
      expect(init.method).toBe('POST')
      expect(init.headers['X-Quackback-Event']).toBe('post.created')
      expect(init.headers['X-Quackback-Signature']).toMatch(/^sha256=/)
    })

    it('fails permanently (no retry) when safeFetch blocks an SSRF target', async () => {
      h.safeFetch.mockRejectedValue(new SsrfError('ssrf-rejected'))
      expect(await webhookHook.run!(event, target, config)).toMatchObject({
        success: false,
        shouldRetry: false,
      })
    })

    it('retries on a timeout', async () => {
      h.safeFetch.mockRejectedValue(new TimeoutError(5000))
      expect(await webhookHook.run!(event, target, config)).toMatchObject({
        success: false,
        shouldRetry: true,
      })
    })

    it('retries a 5xx but not a 4xx response', async () => {
      h.safeFetch.mockResolvedValue(resp(503))
      expect(await webhookHook.run!(event, target, config)).toMatchObject({ shouldRetry: true })
      h.safeFetch.mockResolvedValue(resp(400))
      expect(await webhookHook.run!(event, target, config)).toMatchObject({ shouldRetry: false })
    })
  })

  describe('Webhook Payload Structure', () => {
    it('builds correct event payload structure', () => {
      const event = {
        id: 'test-event-id',
        type: 'post.created',
        timestamp: '2024-01-01T00:00:00Z',
        data: {
          post: {
            id: 'post_123',
            title: 'Test Post',
            content: 'Test content',
            boardId: 'board_456',
            boardSlug: 'feature-requests',
          },
        },
      }

      const payload = JSON.stringify({
        id: `evt_${crypto.randomUUID().replace(/-/g, '')}`,
        type: event.type,
        createdAt: event.timestamp,
        data: event.data,
      })

      const parsed = JSON.parse(payload)
      expect(parsed.id).toMatch(/^evt_[a-f0-9]{32}$/)
      expect(parsed.type).toBe('post.created')
      expect(parsed.createdAt).toBe('2024-01-01T00:00:00Z')
      expect(parsed.data.post.title).toBe('Test Post')
    })
  })

  describe('Signature Verification (Consumer Side)', () => {
    it('verifies signature correctly', () => {
      const secret = 'whsec_test_secret'
      const payload = JSON.stringify({ type: 'post.created', data: {} })
      const timestamp = Math.floor(Date.now() / 1000)

      // Generate signature (producer side)
      const signaturePayload = `${timestamp}.${payload}`
      const signature = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex')

      // Verify signature (consumer side)
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signaturePayload)
        .digest('hex')

      expect(signature).toBe(expectedSignature)
    })

    it('rejects tampered payload', () => {
      const secret = 'whsec_test_secret'
      const originalPayload = JSON.stringify({ type: 'post.created', amount: 100 })
      const tamperedPayload = JSON.stringify({ type: 'post.created', amount: 1000000 })
      const timestamp = Math.floor(Date.now() / 1000)

      // Signature for original payload
      const signature = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${originalPayload}`)
        .digest('hex')

      // Verify against tampered payload fails
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${tamperedPayload}`)
        .digest('hex')

      expect(signature).not.toBe(expectedSignature)
    })

    it('rejects old timestamps (replay attack protection)', () => {
      const currentTime = Math.floor(Date.now() / 1000)
      const oldTimestamp = currentTime - 600 // 10 minutes ago
      const TOLERANCE_SECONDS = 300 // 5 minutes

      const isTimestampValid = Math.abs(currentTime - oldTimestamp) <= TOLERANCE_SECONDS
      expect(isTimestampValid).toBe(false)
    })
  })
})
