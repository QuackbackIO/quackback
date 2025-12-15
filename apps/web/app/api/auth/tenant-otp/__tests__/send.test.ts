import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { POST } from '../send/route'
import { NextRequest } from 'next/server'

/**
 * Strongly-typed mock interfaces for Drizzle ORM query builders.
 * These match the subset of the API actually used in tests.
 */
interface MockInsertBuilder {
  values: Mock
}

interface MockDeleteBuilder {
  where: Mock
}

/**
 * Type-safe factory for creating insert chain mocks.
 * Returns a properly typed mock that satisfies Drizzle's insert API.
 */
function createMockInsertBuilder(valuesFn: Mock = vi.fn()): MockInsertBuilder {
  return { values: valuesFn }
}

/**
 * Type-safe factory for creating delete chain mocks.
 * Returns a properly typed mock that satisfies Drizzle's delete API.
 */
function createMockDeleteBuilder(whereFn: Mock = vi.fn()): MockDeleteBuilder {
  return { where: whereFn }
}

/**
 * Type definition for the mocked database module.
 * This ensures type safety throughout the test file.
 */
interface MockDb {
  query: {
    workspaceDomain: {
      findFirst: Mock
    }
  }
  insert: Mock<() => MockInsertBuilder>
  delete: Mock<() => MockDeleteBuilder>
}

// Mock modules with proper typing
vi.mock('@quackback/db', () => ({
  db: {
    query: {
      workspaceDomain: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(() => createMockInsertBuilder()),
    delete: vi.fn(() => createMockDeleteBuilder()),
  } satisfies MockDb,
  verification: {},
  workspaceDomain: {},
  eq: vi.fn((field, value) => ({ field, value })),
}))

vi.mock('@quackback/email', () => ({
  sendSigninCodeEmail: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  rateLimits: {
    signinCode: { limit: 5, windowMs: 15 * 60 * 1000 },
  },
  getClientIp: vi.fn(() => '192.168.1.1'),
  createRateLimitHeaders: vi.fn((result) => ({
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  })),
}))

// Import mocked modules - cast db to our mock type for proper typing
import { db as _db, eq } from '@quackback/db'
import { sendSigninCodeEmail } from '@quackback/email'
import { checkRateLimit, getClientIp, createRateLimitHeaders } from '@/lib/rate-limit'

const db = _db as unknown as MockDb

describe('POST /api/auth/tenant-otp/send', () => {
  const mockOrganization = {
    id: 'org_123',
    name: 'Test Organization',
    slug: 'test-org',
    createdAt: new Date(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Type for workspace domain with organization relation loaded
  type WorkspaceDomainWithOrg = {
    id: string
    createdAt: Date
    organizationId: string
    domain: string
    domainType: string
    isPrimary: boolean
    verified: boolean
    verificationToken: string | null
    organization?: typeof mockOrganization
  }

  function createMockRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
    const defaultHeaders: Record<string, string> = {
      host: 'test-org.localhost:3000',
      ...headers,
    }

    const request = {
      headers: new Map(Object.entries(defaultHeaders)),
      json: vi.fn().mockResolvedValue(body),
    } as unknown as NextRequest

    // Mock headers.get()
    request.headers.get = vi.fn((key: string) => {
      return defaultHeaders[key.toLowerCase()] ?? null
    })

    return request
  }

  // Helper type for Drizzle query result with relations
  type DrizzleQueryResult = Awaited<ReturnType<typeof db.query.workspaceDomain.findFirst>>

  function mockDatabaseLookup(organization = mockOrganization) {
    const mockResult: WorkspaceDomainWithOrg = {
      id: 'domain-1',
      domain: 'test-org.localhost:3000',
      organizationId: organization.id,
      domainType: 'subdomain',
      isPrimary: true,
      verified: true,
      verificationToken: null,
      createdAt: new Date(),
      organization,
    }
    vi.mocked(db.query.workspaceDomain.findFirst).mockResolvedValue(
      mockResult as DrizzleQueryResult
    )
  }

  function mockRateLimitSuccess() {
    vi.mocked(checkRateLimit).mockReturnValue({
      success: true,
      remaining: 4,
      resetAt: Date.now() + 15 * 60 * 1000,
    })
  }

  function mockRateLimitExceeded() {
    vi.mocked(checkRateLimit).mockReturnValue({
      success: false,
      remaining: 0,
      resetAt: Date.now() + 15 * 60 * 1000,
    })
  }

  describe('Rate Limiting', () => {
    it('returns 429 when rate limit is exceeded', async () => {
      mockRateLimitExceeded()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'test@example.com' })
      const response = await POST(request)

      expect(response.status).toBe(429)
      const data = await response.json()
      expect(data).toEqual({
        error: 'Too many requests. Please try again later.',
      })
      expect(createRateLimitHeaders).toHaveBeenCalled()
    })

    it('checks rate limit with correct identifier', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()
      vi.mocked(getClientIp).mockReturnValue('192.168.1.100')

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      expect(checkRateLimit).toHaveBeenCalledWith(
        'tenant-otp:192.168.1.100',
        expect.objectContaining({
          limit: 5,
          windowMs: 15 * 60 * 1000,
        })
      )
    })

    it('includes rate limit headers in 429 response', async () => {
      const _resetAt = Date.now() + 15 * 60 * 1000
      mockRateLimitExceeded()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'test@example.com' })
      const response = await POST(request)

      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
      expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy()
    })
  })

  describe('Valid Email', () => {
    it('sends OTP code successfully for valid email', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'test@example.com' })
      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({ success: true })
      expect(sendSigninCodeEmail).toHaveBeenCalled()
    })

    it('creates verification record in database', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      expect(db.insert).toHaveBeenCalled()
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          identifier: 'tenant-otp:org_123:test@example.com',
          value: expect.stringMatching(/^\d{6}$/),
          expiresAt: expect.any(Date),
        })
      )
    })

    it('deletes existing verification records before creating new one', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockWhere = vi.fn()
      db.delete.mockReturnValue(createMockDeleteBuilder(mockWhere))

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      expect(db.delete).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
      expect(eq).toHaveBeenCalled()
    })
  })

  describe('OTP Code Format', () => {
    it('generates 6-digit code', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      const insertCall = mockInsert.mock.calls[0][0]
      expect(insertCall.value).toMatch(/^\d{6}$/)
      expect(insertCall.value.length).toBe(6)
      expect(parseInt(insertCall.value, 10)).toBeGreaterThanOrEqual(100000)
      expect(parseInt(insertCall.value, 10)).toBeLessThanOrEqual(999999)
    })

    it('sends code via email with correct format', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      expect(sendSigninCodeEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        code: expect.stringMatching(/^\d{6}$/),
      })
    })
  })

  describe('OTP Code Expiry', () => {
    it('sets expiry to 10 minutes from now', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const now = new Date('2025-01-01T00:00:00Z')
      vi.setSystemTime(now)

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      const insertCall = mockInsert.mock.calls[0][0]
      const expectedExpiry = new Date(now.getTime() + 10 * 60 * 1000)
      expect(insertCall.expiresAt).toEqual(expectedExpiry)
    })

    it('expiry is exactly 600000ms (10 minutes)', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const now = Date.now()
      vi.setSystemTime(now)

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      const insertCall = mockInsert.mock.calls[0][0]
      const expiryTime = insertCall.expiresAt.getTime()
      expect(expiryTime - now).toBe(10 * 60 * 1000)
    })
  })

  describe('Email Normalization', () => {
    it('lowercases email addresses', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'TEST@EXAMPLE.COM' })
      await POST(request)

      expect(sendSigninCodeEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        code: expect.any(String),
      })
    })

    it('rejects email with leading/trailing whitespace (validates before trim)', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: '  test@example.com  ' })
      const response = await POST(request)

      // Email validation happens before trimming, so this fails validation
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Invalid email address' })
    })

    it('lowercases email in identifier', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const request = createMockRequest({ email: 'TEST@EXAMPLE.COM' })
      await POST(request)

      const insertCall = mockInsert.mock.calls[0][0]
      expect(insertCall.identifier).toBe('tenant-otp:org_123:test@example.com')
    })

    it('rejects mixed case with spaces (validates before normalize)', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: ' TeSt@ExAmPlE.cOm ' })
      const response = await POST(request)

      // Email validation happens before normalization, so whitespace causes failure
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Invalid email address' })
    })
  })

  describe('Organization-Scoped Identifier', () => {
    it('uses correct identifier format', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      const insertCall = mockInsert.mock.calls[0][0]
      expect(insertCall.identifier).toBe('tenant-otp:org_123:test@example.com')
    })

    it('scopes identifier to organization ID', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup({
        ...mockOrganization,
        id: 'org_different',
      })

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      const insertCall = mockInsert.mock.calls[0][0]
      expect(insertCall.identifier).toBe('tenant-otp:org_different:test@example.com')
    })

    it('includes colon-separated format', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const request = createMockRequest({ email: 'user@domain.com' })
      await POST(request)

      const insertCall = mockInsert.mock.calls[0][0]
      const parts = insertCall.identifier.split(':')
      expect(parts).toHaveLength(3)
      expect(parts[0]).toBe('tenant-otp')
      expect(parts[1]).toBe('org_123')
      expect(parts[2]).toBe('user@domain.com')
    })
  })

  describe('Email Sending via Resend', () => {
    it('calls sendSigninCodeEmail with correct parameters', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      expect(sendSigninCodeEmail).toHaveBeenCalledTimes(1)
      expect(sendSigninCodeEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        code: expect.stringMatching(/^\d{6}$/),
      })
    })

    it('handles email sending errors gracefully', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()
      vi.mocked(sendSigninCodeEmail).mockRejectedValue(new Error('Email service down'))

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const request = createMockRequest({ email: 'test@example.com' })
      const response = await POST(request)

      // Should still return success to prevent enumeration
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({ success: true })
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to send OTP email:', expect.any(Error))

      consoleErrorSpy.mockRestore()
    })

    it('does not throw error when email fails', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()
      vi.mocked(sendSigninCodeEmail).mockRejectedValue(new Error('SMTP connection failed'))

      const request = createMockRequest({ email: 'test@example.com' })

      await expect(POST(request)).resolves.not.toThrow()
    })
  })

  describe('Email Enumeration Prevention', () => {
    it('always returns success for valid format', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'nonexistent@example.com' })
      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({ success: true })
    })

    it('returns success even when email sending fails', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()
      vi.mocked(sendSigninCodeEmail).mockRejectedValue(new Error('Invalid email'))

      const request = createMockRequest({ email: 'test@example.com' })
      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({ success: true })
    })

    it('suppresses email errors from response', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()
      vi.mocked(sendSigninCodeEmail).mockRejectedValue(new Error('Email bounced'))

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const request = createMockRequest({ email: 'bounced@example.com' })
      const response = await POST(request)
      const data = await response.json()

      expect(data).not.toHaveProperty('emailError')
      expect(data).toEqual({ success: true })

      consoleErrorSpy.mockRestore()
    })
  })

  describe('Invalid Email Format', () => {
    it('rejects email without @ symbol', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'notanemail' })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Invalid email address' })
    })

    it('rejects email without domain', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'test@' })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Invalid email address' })
    })

    it('rejects email without TLD', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'test@example' })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Invalid email address' })
    })

    it('rejects email with spaces', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'test @example.com' })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Invalid email address' })
    })

    it('rejects empty string email', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: '' })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Email is required' })
    })

    it('does not send email for invalid format', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'invalid' })
      await POST(request)

      expect(sendSigninCodeEmail).not.toHaveBeenCalled()
    })

    it('does not create verification record for invalid format', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'invalid' })
      await POST(request)

      expect(db.insert).not.toHaveBeenCalled()
    })
  })

  describe('Missing Email Parameter', () => {
    it('rejects request without email field', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({})
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Email is required' })
    })

    it('rejects request with null email', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: null })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Email is required' })
    })

    it('rejects request with non-string email', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 123 })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Email is required' })
    })

    it('rejects request with array email', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: ['test@example.com'] })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Email is required' })
    })

    it('rejects request with object email', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: { value: 'test@example.com' } })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Email is required' })
    })
  })

  describe('Organization Lookup from Host Header', () => {
    it('looks up organization from host header', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest(
        { email: 'test@example.com' },
        { host: 'custom.example.com' }
      )
      await POST(request)

      expect(db.query.workspaceDomain.findFirst).toHaveBeenCalledWith({
        where: expect.anything(),
        with: { organization: true },
      })
    })

    it('rejects request without host header', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'test@example.com' }, { host: '' })
      // Override to return null
      request.headers.get = vi.fn(() => null)

      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Invalid request' })
    })

    it('rejects request when organization not found', async () => {
      mockRateLimitSuccess()
      vi.mocked(db.query.workspaceDomain.findFirst).mockResolvedValue(undefined)

      const request = createMockRequest({ email: 'test@example.com' })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Invalid request' })
    })

    it('rejects request when domain record has no organization', async () => {
      mockRateLimitSuccess()
      const mockResult: WorkspaceDomainWithOrg = {
        id: 'domain-1',
        domain: 'test-org.localhost:3000',
        organizationId: 'org_123',
        domainType: 'subdomain',
        isPrimary: true,
        verified: true,
        verificationToken: null,
        createdAt: new Date(),
        organization: undefined,
      }
      vi.mocked(db.query.workspaceDomain.findFirst).mockResolvedValue(
        mockResult as DrizzleQueryResult
      )

      const request = createMockRequest({ email: 'test@example.com' })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ error: 'Invalid request' })
    })

    it('uses exact host value for domain lookup', async () => {
      mockRateLimitSuccess()
      const mockResult: WorkspaceDomainWithOrg = {
        id: 'domain-1',
        domain: 'subdomain.example.com',
        organizationId: mockOrganization.id,
        domainType: 'custom',
        isPrimary: true,
        verified: true,
        verificationToken: null,
        createdAt: new Date(),
        organization: mockOrganization,
      }
      vi.mocked(db.query.workspaceDomain.findFirst).mockResolvedValue(
        mockResult as DrizzleQueryResult
      )

      const request = createMockRequest(
        { email: 'test@example.com' },
        { host: 'subdomain.example.com' }
      )
      await POST(request)

      expect(db.query.workspaceDomain.findFirst).toHaveBeenCalled()
    })
  })

  describe('Verification Record Creation', () => {
    it('creates record with UUID', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      const insertCall = mockInsert.mock.calls[0][0]
      expect(insertCall.id).toMatch(/^verification_[0-9a-z]{26}$/)
    })

    it('creates record with all required fields', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      const insertCall = mockInsert.mock.calls[0][0]
      expect(insertCall).toHaveProperty('id')
      expect(insertCall).toHaveProperty('identifier')
      expect(insertCall).toHaveProperty('value')
      expect(insertCall).toHaveProperty('expiresAt')
    })

    it('stores code as string value', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      const insertCall = mockInsert.mock.calls[0][0]
      expect(typeof insertCall.value).toBe('string')
      expect(insertCall.value).toMatch(/^\d{6}$/)
    })

    it('uses lowercase email in identifier', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const request = createMockRequest({ email: 'TEST@EXAMPLE.COM' })
      await POST(request)

      const insertCall = mockInsert.mock.calls[0][0]
      expect(insertCall.identifier).toContain('test@example.com')
      expect(insertCall.identifier).not.toContain('TEST@EXAMPLE.COM')
    })
  })

  describe('Error Handling', () => {
    it('returns 500 on database error', async () => {
      mockRateLimitSuccess()
      vi.mocked(db.query.workspaceDomain.findFirst).mockRejectedValue(
        new Error('Database connection failed')
      )

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const request = createMockRequest({ email: 'test@example.com' })
      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data).toEqual({ error: 'Something went wrong' })
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error in tenant-otp/send:', expect.any(Error))

      consoleErrorSpy.mockRestore()
    })

    it('logs errors to console', async () => {
      mockRateLimitSuccess()
      vi.mocked(db.query.workspaceDomain.findFirst).mockRejectedValue(new Error('Test error'))

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const request = createMockRequest({ email: 'test@example.com' })
      await POST(request)

      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })

    it('handles malformed JSON gracefully', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const request = createMockRequest({ email: 'test@example.com' })
      vi.mocked(request.json).mockRejectedValue(new Error('Invalid JSON'))

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data).toEqual({ error: 'Something went wrong' })

      consoleErrorSpy.mockRestore()
    })
  })

  describe('Integration Scenarios', () => {
    it('handles complete successful flow', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockWhere = vi.fn()
      const mockInsert = vi.fn()

      db.delete.mockReturnValue(createMockDeleteBuilder(mockWhere))

      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const request = createMockRequest({ email: 'test@example.com' })
      const response = await POST(request)

      // Verify rate limit check
      expect(checkRateLimit).toHaveBeenCalled()

      // Verify organization lookup
      expect(db.query.workspaceDomain.findFirst).toHaveBeenCalled()

      // Verify old codes deleted
      expect(db.delete).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()

      // Verify new code created
      expect(db.insert).toHaveBeenCalled()
      expect(mockInsert).toHaveBeenCalled()

      // Verify email sent
      expect(sendSigninCodeEmail).toHaveBeenCalled()

      // Verify success response
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({ success: true })
    })

    it('processes multiple different emails correctly', async () => {
      mockRateLimitSuccess()
      mockDatabaseLookup()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      const emails = ['user1@example.com', 'user2@example.com', 'user3@example.com']

      for (const email of emails) {
        const request = createMockRequest({ email })
        const response = await POST(request)
        expect(response.status).toBe(200)
      }

      expect(mockInsert).toHaveBeenCalledTimes(3)
      expect(sendSigninCodeEmail).toHaveBeenCalledTimes(3)

      // Verify each email got its own identifier
      const identifiers = mockInsert.mock.calls.map((call) => call[0].identifier)
      expect(new Set(identifiers).size).toBe(3)
    })

    it('handles different organizations separately', async () => {
      mockRateLimitSuccess()

      const mockInsert = vi.fn()
      db.insert.mockReturnValue(createMockInsertBuilder(mockInsert))

      // First organization
      const mockResult1: WorkspaceDomainWithOrg = {
        id: 'domain-1',
        domain: 'org1.localhost:3000',
        organizationId: 'org_111',
        domainType: 'subdomain',
        isPrimary: true,
        verified: true,
        verificationToken: null,
        createdAt: new Date(),
        organization: { ...mockOrganization, id: 'org_111' },
      }
      vi.mocked(db.query.workspaceDomain.findFirst).mockResolvedValueOnce(
        mockResult1 as DrizzleQueryResult
      )

      const request1 = createMockRequest(
        { email: 'test@example.com' },
        { host: 'org1.localhost:3000' }
      )
      await POST(request1)

      // Second organization
      const mockResult2: WorkspaceDomainWithOrg = {
        id: 'domain-2',
        domain: 'org2.localhost:3000',
        organizationId: 'org_222',
        domainType: 'subdomain',
        isPrimary: true,
        verified: true,
        verificationToken: null,
        createdAt: new Date(),
        organization: { ...mockOrganization, id: 'org_222' },
      }
      vi.mocked(db.query.workspaceDomain.findFirst).mockResolvedValueOnce(
        mockResult2 as DrizzleQueryResult
      )

      const request2 = createMockRequest(
        { email: 'test@example.com' },
        { host: 'org2.localhost:3000' }
      )
      await POST(request2)

      // Verify different identifiers for same email in different orgs
      const identifier1 = mockInsert.mock.calls[0][0].identifier
      const identifier2 = mockInsert.mock.calls[1][0].identifier

      expect(identifier1).toBe('tenant-otp:org_111:test@example.com')
      expect(identifier2).toBe('tenant-otp:org_222:test@example.com')
      expect(identifier1).not.toBe(identifier2)
    })
  })
})
