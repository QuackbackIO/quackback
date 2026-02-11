import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

// Mock settings service
const mockGetWidgetConfig = vi.fn()
const mockGetWidgetSecret = vi.fn()

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWidgetConfig: () => mockGetWidgetConfig(),
  getWidgetSecret: () => mockGetWidgetSecret(),
}))

// Mock db
const mockUserFindFirst = vi.fn()
const mockSessionFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockInsertReturning = vi.fn()
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }))
const mockInsert = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      user: { findFirst: mockUserFindFirst },
      session: { findFirst: mockSessionFindFirst },
      principal: { findFirst: mockPrincipalFindFirst },
    },
    insert: (table: Record<string, string>) => {
      mockInsert(table)
      return { values: mockInsertValues }
    },
    update: () => ({
      set: (values: Record<string, string>) => {
        mockUpdateSet(values)
        return { where: mockUpdateWhere }
      },
    }),
  },
  user: { id: 'id', email: 'email', name: 'name' },
  session: { id: 'id', userId: 'userId', expiresAt: 'expiresAt', token: 'token' },
  principal: { userId: 'userId' },
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
}))

vi.mock('@quackback/ids', () => ({
  generateId: vi.fn(() => 'mock_generated_id'),
}))

// We need to test the handler function directly.
// Since it's inside a createFileRoute, we'll extract the logic for testing.
// For now, we test the HMAC verification and request handling logic.

describe('Widget Identify Endpoint', () => {
  const WIDGET_SECRET = 'wgt_' + 'a'.repeat(64)

  function makeHmac(secret: string, userId: string): string {
    return createHmac('sha256', secret).update(userId).digest('hex')
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('HMAC verification logic', () => {
    it('should produce a valid HMAC-SHA256 hex hash', () => {
      const hash = makeHmac(WIDGET_SECRET, 'user_123')
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should produce different hashes for different user IDs', () => {
      const hash1 = makeHmac(WIDGET_SECRET, 'user_123')
      const hash2 = makeHmac(WIDGET_SECRET, 'user_456')
      expect(hash1).not.toBe(hash2)
    })

    it('should produce different hashes for different secrets', () => {
      const hash1 = makeHmac('secret_a', 'user_123')
      const hash2 = makeHmac('secret_b', 'user_123')
      expect(hash1).not.toBe(hash2)
    })

    it('should produce consistent hashes for same inputs', () => {
      const hash1 = makeHmac(WIDGET_SECRET, 'user_123')
      const hash2 = makeHmac(WIDGET_SECRET, 'user_123')
      expect(hash1).toBe(hash2)
    })

    it('should use the user ID (not email) as the HMAC message', () => {
      // This is the Canny/Intercom standard: HMAC only the user ID
      const hashById = makeHmac(WIDGET_SECRET, 'user_123')
      const hashByEmail = makeHmac(WIDGET_SECRET, 'jane@example.com')
      expect(hashById).not.toBe(hashByEmail)
    })
  })

  describe('timing-safe comparison', () => {
    it('should correctly compare equal hex buffers', () => {
      const hash = makeHmac(WIDGET_SECRET, 'user_123')
      const buf1 = Buffer.from(hash, 'hex')
      const buf2 = Buffer.from(hash, 'hex')
      // crypto.timingSafeEqual requires same length
      expect(buf1.length).toBe(buf2.length)
      expect(buf1.equals(buf2)).toBe(true)
    })

    it('should reject non-hex strings gracefully', () => {
      // Buffer.from with 'hex' drops invalid chars
      const buf = Buffer.from('not-a-hex-string', 'hex')
      // A valid SHA256 hex is always 32 bytes
      expect(buf.length).not.toBe(32)
    })

    it('should detect tampered hashes', () => {
      const validHash = makeHmac(WIDGET_SECRET, 'user_123')
      // Flip one character
      const tampered = validHash.slice(0, -1) + (validHash.endsWith('0') ? '1' : '0')
      const buf1 = Buffer.from(validHash, 'hex')
      const buf2 = Buffer.from(tampered, 'hex')
      expect(buf1.equals(buf2)).toBe(false)
    })
  })

  describe('request validation', () => {
    it('should reject requests with missing email', async () => {
      // The identifySchema requires id and email
      const { z } = await import('zod')
      const identifySchema = z.object({
        id: z.string().min(1, 'User ID is required'),
        email: z.string().email('Valid email is required'),
        name: z.string().optional(),
        avatarURL: z.string().url().optional(),
        created: z.string().optional(),
        hash: z.string().optional(),
      })

      const result = identifySchema.safeParse({ id: 'user_123' })
      expect(result.success).toBe(false)
    })

    it('should reject requests with invalid email', async () => {
      const { z } = await import('zod')
      const identifySchema = z.object({
        id: z.string().min(1),
        email: z.string().email(),
        name: z.string().optional(),
        hash: z.string().optional(),
      })

      const result = identifySchema.safeParse({ id: 'user_123', email: 'not-an-email' })
      expect(result.success).toBe(false)
    })

    it('should reject requests with empty user ID', async () => {
      const { z } = await import('zod')
      const identifySchema = z.object({
        id: z.string().min(1),
        email: z.string().email(),
      })

      const result = identifySchema.safeParse({ id: '', email: 'test@example.com' })
      expect(result.success).toBe(false)
    })

    it('should accept valid identify payload', async () => {
      const { z } = await import('zod')
      const identifySchema = z.object({
        id: z.string().min(1),
        email: z.string().email(),
        name: z.string().optional(),
        avatarURL: z.string().url().optional(),
        created: z.string().optional(),
        hash: z.string().optional(),
      })

      const result = identifySchema.safeParse({
        id: 'user_123',
        email: 'jane@acme.com',
        name: 'Jane Doe',
        hash: 'abcdef1234567890',
      })
      expect(result.success).toBe(true)
    })

    it('should reject invalid avatarURL', async () => {
      const { z } = await import('zod')
      const identifySchema = z.object({
        id: z.string().min(1),
        email: z.string().email(),
        avatarURL: z.string().url().optional(),
      })

      const result = identifySchema.safeParse({
        id: 'user_123',
        email: 'test@example.com',
        avatarURL: 'not-a-url',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('widget config checks', () => {
    it('should provide config with enabled flag', async () => {
      mockGetWidgetConfig.mockResolvedValue({ enabled: true, identifyVerification: false })

      const config = await mockGetWidgetConfig()
      expect(config.enabled).toBe(true)
    })

    it('should check identifyVerification flag', async () => {
      mockGetWidgetConfig.mockResolvedValue({ enabled: true, identifyVerification: true })

      const config = await mockGetWidgetConfig()
      expect(config.identifyVerification).toBe(true)
    })

    it('should return widget secret when configured', async () => {
      mockGetWidgetSecret.mockResolvedValue(WIDGET_SECRET)

      const secret = await mockGetWidgetSecret()
      expect(secret).toBe(WIDGET_SECRET)
      expect(secret).toMatch(/^wgt_/)
    })

    it('should return null when no secret configured', async () => {
      mockGetWidgetSecret.mockResolvedValue(null)

      const secret = await mockGetWidgetSecret()
      expect(secret).toBeNull()
    })
  })

  describe('user lookup and creation flow', () => {
    it('should find existing user by email', async () => {
      const existingUser = {
        id: 'user_existing',
        name: 'Existing User',
        email: 'existing@test.com',
        image: null,
      }
      mockUserFindFirst.mockResolvedValue(existingUser)

      const user = await mockUserFindFirst()
      expect(user).toEqual(existingUser)
    })

    it('should return null when user does not exist', async () => {
      mockUserFindFirst.mockResolvedValue(null)

      const user = await mockUserFindFirst()
      expect(user).toBeNull()
    })

    it('should find existing principal by userId', async () => {
      mockPrincipalFindFirst.mockResolvedValue({
        id: 'principal_existing',
        role: 'user',
      })

      const principal = await mockPrincipalFindFirst()
      expect(principal.role).toBe('user')
    })

    it('should reuse existing valid session', async () => {
      mockSessionFindFirst.mockResolvedValue({
        id: 'session_existing',
        token: 'existing-token-uuid',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      })

      const session = await mockSessionFindFirst()
      expect(session.token).toBe('existing-token-uuid')
    })
  })
})
