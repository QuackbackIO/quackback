/**
 * Webhook Handler Unit Tests
 *
 * Tests for webhook delivery logic including:
 * - HMAC signature generation
 * - SSRF protection (private IP blocking)
 * - Request timeout handling
 * - Secret handling (never carried in the job config; fetched at delivery time)
 * - Idempotency (duplicate-delivery skip, retryable-failure release)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const h = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  claim: vi.fn(async () => true),
  release: vi.fn(async () => undefined),
  complete: vi.fn(async () => undefined),
  fail: vi.fn(async () => undefined),
  findFirstWebhook: vi.fn(),
  decryptWebhookSecret: vi.fn(),
}))

// Mock the db import before importing the handler
// Spread the real db module so tables/operators stay current; override only what this suite drives.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    query: {
      webhooks: {
        findFirst: (...args: unknown[]) => h.findFirstWebhook(...args),
      },
    },
  },
  eq: vi.fn(),
  sql: vi.fn(),
}))

// Keep the real SsrfError/TimeoutError classes (instanceof drives retry
// classification); mock only the network call + the idempotency claim.
vi.mock('@/lib/server/content/ssrf-guard', async (orig) => {
  const actual = await orig<typeof import('@/lib/server/content/ssrf-guard')>()
  return { ...actual, safeFetch: (...a: unknown[]) => h.safeFetch(...a) }
})
vi.mock('../hook-idempotency', () => ({
  claimHookDelivery: () => h.claim(),
  releaseHookDelivery: () => h.release(),
  completeHookDelivery: () => h.complete(),
  failHookDelivery: () => h.fail(),
}))
vi.mock('@/lib/server/domains/webhooks/encryption', () => ({
  decryptWebhookSecret: (...args: unknown[]) => h.decryptWebhookSecret(...args),
}))

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
    // The config a real job carries: only the identifier, never the secret
    // (see the "Secret handling" suite below for the dedicated coverage).
    const config = { webhookId: 'webhook_1' }
    const resp = (status: number): Response =>
      ({ ok: status >= 200 && status < 300, status }) as Response

    beforeEach(() => {
      vi.clearAllMocks()
      h.claim.mockResolvedValue(true)
      h.findFirstWebhook.mockResolvedValue({ secret: 'encrypted:whsec_test' })
      h.decryptWebhookSecret.mockImplementation((ciphertext: string) =>
        ciphertext.replace(/^encrypted:/, '')
      )
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
      expect(h.complete).toHaveBeenCalledOnce()
      expect(h.release).not.toHaveBeenCalled()
      expect(h.fail).not.toHaveBeenCalled()
    })

    it('fails permanently (no retry) when safeFetch blocks an SSRF target', async () => {
      h.safeFetch.mockRejectedValue(new SsrfError('ssrf-rejected'))
      expect(await webhookHook.run!(event, target, config)).toMatchObject({
        success: false,
        shouldRetry: false,
      })
      expect(h.fail).toHaveBeenCalledOnce()
      expect(h.release).not.toHaveBeenCalled()
      expect(h.complete).not.toHaveBeenCalled()
    })

    it('retries on a timeout', async () => {
      h.safeFetch.mockRejectedValue(new TimeoutError(5000))
      expect(await webhookHook.run!(event, target, config)).toMatchObject({
        success: false,
        shouldRetry: true,
      })
      expect(h.release).toHaveBeenCalledOnce()
      expect(h.fail).not.toHaveBeenCalled()
      expect(h.complete).not.toHaveBeenCalled()
    })

    it('retries a 5xx but not a 4xx response', async () => {
      h.safeFetch.mockResolvedValue(resp(503))
      expect(await webhookHook.run!(event, target, config)).toMatchObject({ shouldRetry: true })
      expect(h.release).toHaveBeenCalledOnce()
      expect(h.fail).not.toHaveBeenCalled()

      vi.clearAllMocks()
      h.claim.mockResolvedValue(true)
      h.findFirstWebhook.mockResolvedValue({ secret: 'encrypted:whsec_test' })
      h.decryptWebhookSecret.mockImplementation((ciphertext: string) =>
        ciphertext.replace(/^encrypted:/, '')
      )

      h.safeFetch.mockResolvedValue(resp(400))
      expect(await webhookHook.run!(event, target, config)).toMatchObject({ shouldRetry: false })
      expect(h.fail).toHaveBeenCalledOnce()
      expect(h.release).not.toHaveBeenCalled()
    })

    it('skips delivery entirely when the claim is already held (duplicate re-run)', async () => {
      h.claim.mockResolvedValue(false)
      const res = await webhookHook.run!(event, target, config)
      expect(res).toEqual({ success: true })
      expect(h.safeFetch).not.toHaveBeenCalled()
      expect(h.findFirstWebhook).not.toHaveBeenCalled()
      expect(h.complete).not.toHaveBeenCalled()
      expect(h.release).not.toHaveBeenCalled()
      expect(h.fail).not.toHaveBeenCalled()
    })
  })

  describe('Secret handling', () => {
    const event = {
      id: 'evt_1',
      type: 'post.created',
      timestamp: '2026-01-01T00:00:00Z',
      actor: { type: 'user' },
      data: { post: { id: 'post_1' } },
    } as never
    const target = { url: 'https://hooks.example.com/deliver' }
    const config = { webhookId: 'webhook_1' }

    beforeEach(() => {
      vi.clearAllMocks()
      h.claim.mockResolvedValue(true)
    })

    it('never reads a secret off the job config -- it is fetched and decrypted at delivery time', async () => {
      expect(config).not.toHaveProperty('secret')

      h.findFirstWebhook.mockResolvedValue({ secret: 'encrypted:whsec_live' })
      h.decryptWebhookSecret.mockImplementation((ciphertext: string) =>
        ciphertext.replace(/^encrypted:/, '')
      )
      h.safeFetch.mockResolvedValue({ ok: true, status: 200 } as Response)

      const res = await webhookHook.run!(event, target, config)
      expect(res.success).toBe(true)

      // Looked up by the webhookId carried in the job, decrypted exactly once.
      expect(h.findFirstWebhook).toHaveBeenCalledOnce()
      expect(h.decryptWebhookSecret).toHaveBeenCalledWith('encrypted:whsec_live')

      // The signature on the wire is derived from the fetched-and-decrypted
      // secret, not anything present in the job's config.
      const [, init] = h.safeFetch.mock.calls[0]
      const body = init.body as string
      const timestamp = init.headers['X-Quackback-Timestamp'] as string
      const expectedSignature = crypto
        .createHmac('sha256', 'whsec_live')
        .update(`${timestamp}.${body}`)
        .digest('hex')
      expect(init.headers['X-Quackback-Signature']).toBe(`sha256=${expectedSignature}`)
    })

    it('fails permanently when the webhook row is gone (deleted after enqueue)', async () => {
      h.findFirstWebhook.mockResolvedValue(undefined)
      const res = await webhookHook.run!(event, target, config)
      expect(res).toMatchObject({ success: false, shouldRetry: false })
      expect(h.fail).toHaveBeenCalledOnce()
      expect(h.release).not.toHaveBeenCalled()
      expect(h.safeFetch).not.toHaveBeenCalled()
    })

    it('releases the claim and retries when the secret lookup throws', async () => {
      h.findFirstWebhook.mockRejectedValue(new Error('connection reset'))
      const res = await webhookHook.run!(event, target, config)
      expect(res).toMatchObject({ success: false, shouldRetry: true })
      expect(h.release).toHaveBeenCalledOnce()
      expect(h.fail).not.toHaveBeenCalled()
      expect(h.safeFetch).not.toHaveBeenCalled()
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
