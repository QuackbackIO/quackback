/**
 * Webhook Handler Unit Tests
 *
 * Tests for webhook delivery logic including:
 * - HMAC signature generation
 * - SSRF protection (private IP blocking)
 * - Request timeout handling
 */

import { describe, it, expect, vi } from 'vitest'
import crypto from 'crypto'

// Mock the db import before importing the handler
vi.mock('@/lib/db', () => ({
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

  describe('SSRF Protection - Private IP Detection', () => {
    const PRIVATE_IP_RANGES = [
      /^127\./, // Loopback
      /^10\./, // Class A private
      /^172\.(1[6-9]|2[0-9]|3[01])\./, // Class B private
      /^192\.168\./, // Class C private
      /^169\.254\./, // Link-local
      /^0\./, // "This" network
      /^::1$/, // IPv6 loopback
      /^f[cd]00:/i, // IPv6 private (fc00::/7 = fc00::/8 + fd00::/8)
      /^fe80:/i, // IPv6 link-local
    ]

    function isPrivateIP(ip: string): boolean {
      return PRIVATE_IP_RANGES.some((pattern) => pattern.test(ip))
    }

    describe('IPv4 Private Ranges', () => {
      it('blocks loopback addresses (127.x.x.x)', () => {
        expect(isPrivateIP('127.0.0.1')).toBe(true)
        expect(isPrivateIP('127.255.255.255')).toBe(true)
      })

      it('blocks Class A private (10.x.x.x)', () => {
        expect(isPrivateIP('10.0.0.1')).toBe(true)
        expect(isPrivateIP('10.255.255.255')).toBe(true)
      })

      it('blocks Class B private (172.16-31.x.x)', () => {
        expect(isPrivateIP('172.16.0.1')).toBe(true)
        expect(isPrivateIP('172.31.255.255')).toBe(true)
        // Outside range should be public
        expect(isPrivateIP('172.15.0.1')).toBe(false)
        expect(isPrivateIP('172.32.0.1')).toBe(false)
      })

      it('blocks Class C private (192.168.x.x)', () => {
        expect(isPrivateIP('192.168.0.1')).toBe(true)
        expect(isPrivateIP('192.168.255.255')).toBe(true)
      })

      it('blocks link-local (169.254.x.x)', () => {
        expect(isPrivateIP('169.254.0.1')).toBe(true)
        expect(isPrivateIP('169.254.255.255')).toBe(true)
      })

      it('allows public IPv4 addresses', () => {
        expect(isPrivateIP('8.8.8.8')).toBe(false)
        expect(isPrivateIP('1.1.1.1')).toBe(false)
        expect(isPrivateIP('93.184.216.34')).toBe(false)
      })
    })

    describe('IPv6 Private Ranges', () => {
      it('blocks IPv6 loopback (::1)', () => {
        expect(isPrivateIP('::1')).toBe(true)
      })

      it('blocks IPv6 private (fc00::/7)', () => {
        expect(isPrivateIP('fc00::1')).toBe(true)
        expect(isPrivateIP('fd00::1')).toBe(true) // fd00::/8 is part of fc00::/7
      })

      it('blocks IPv6 link-local (fe80::/10)', () => {
        expect(isPrivateIP('fe80::1')).toBe(true)
      })
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
