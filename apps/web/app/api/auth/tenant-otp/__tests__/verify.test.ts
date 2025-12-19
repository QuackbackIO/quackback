import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../verify/route'
import { NextRequest } from 'next/server'

// Mock workspaceService - must be hoisted for vi.mock to access
const { mockGetAuthConfig } = vi.hoisted(() => ({
  mockGetAuthConfig: vi.fn(),
}))

vi.mock('@quackback/domain', () => ({
  workspaceService: {
    getAuthConfig: mockGetAuthConfig,
  },
}))

// Mock database - must be hoisted for vi.mock to access
const mockDb = vi.hoisted(() => ({
  query: {
    workspaceDomain: {
      findFirst: vi.fn(),
    },
    verification: {
      findFirst: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    invitation: {
      findFirst: vi.fn(),
    },
  },
  delete: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}))

// Mock rate limiting functions - must be hoisted for vi.mock to access
const { mockCheckRateLimit, mockGetClientIp, mockCreateRateLimitHeaders } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockCreateRateLimitHeaders: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
  verification: {
    id: 'id',
    identifier: 'identifier',
    value: 'value',
    expiresAt: 'expiresAt',
  },
  user: {
    email: 'email',
    workspaceId: 'workspaceId',
    id: 'id',
  },
  account: {
    id: 'id',
  },
  member: {
    id: 'id',
  },
  invitation: {
    id: 'id',
    status: 'status',
    workspaceId: 'workspaceId',
  },
  workspaceDomain: {
    domain: 'domain',
  },
  sessionTransferToken: {
    id: 'id',
  },
  eq: vi.fn((...args) => ({ eq: args })),
  and: vi.fn((...args) => ({ and: args })),
  gt: vi.fn((...args) => ({ gt: args })),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
  createRateLimitHeaders: mockCreateRateLimitHeaders,
  rateLimits: {
    signinCodeVerify: { limit: 10, windowMs: 15 * 60 * 1000 },
  },
}))

// Mock crypto.getRandomValues
const mockRandomValues = vi.fn()
const mockRandomUUID = vi.fn(() => 'test-uuid-1234')

vi.stubGlobal('crypto', {
  getRandomValues: mockRandomValues,
  randomUUID: mockRandomUUID,
})

describe('POST /api/auth/tenant-otp/verify', () => {
  let mockRequest: NextRequest
  const mockWorkspaceId = 'org-123'
  const mockUserId = 'user-123'
  const mockEmail = 'test@example.com'
  const mockCode = '123456'
  const mockHost = 'acme.localhost:3000'

  beforeEach(() => {
    vi.clearAllMocks()

    // Default rate limit success
    mockCheckRateLimit.mockReturnValue({
      success: true,
      remaining: 9,
      resetAt: Date.now() + 900000,
    })

    mockGetClientIp.mockReturnValue('127.0.0.1')
    mockCreateRateLimitHeaders.mockReturnValue({})

    // Mock crypto.getRandomValues to return predictable bytes
    mockRandomValues.mockImplementation((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = i % 256
      }
      return arr
    })

    // Default workspace domain lookup
    mockDb.query.workspaceDomain.findFirst.mockResolvedValue({
      domain: mockHost,
      workspace: {
        id: mockWorkspaceId,
        slug: 'acme',
        name: 'Acme Corp',
      },
    })

    // Default auth config (openSignup disabled)
    mockGetAuthConfig.mockResolvedValue({
      success: true,
      value: {
        oauth: { google: true, github: true, microsoft: false },
        ssoRequired: false,
        openSignup: false,
      },
    })

    // Mock request
    const mockHeaders = new Headers({
      host: mockHost,
      'x-forwarded-proto': 'http',
    })

    mockRequest = {
      headers: mockHeaders,
      json: vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        context: 'portal',
        callbackUrl: '/',
        popup: false,
      }),
    } as unknown as NextRequest
  })

  describe('Rate Limiting', () => {
    it('should return 429 when rate limit is exceeded', async () => {
      mockCheckRateLimit.mockReturnValue({
        success: false,
        remaining: 0,
        resetAt: Date.now() + 900000,
      })

      mockCreateRateLimitHeaders.mockReturnValue({
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '1234567890',
        'Retry-After': '900',
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(429)
      expect(data.error).toBe('Too many attempts. Please try again later.')
      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        'tenant-otp-verify:127.0.0.1',
        expect.any(Object)
      )
    })

    it('should check rate limit by IP address', async () => {
      mockGetClientIp.mockReturnValue('192.168.1.100')

      mockDb.query.verification.findFirst.mockResolvedValue(null)

      await POST(mockRequest)

      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        'tenant-otp-verify:192.168.1.100',
        expect.any(Object)
      )
    })
  })

  describe('Valid Code Verification - Login Flow', () => {
    beforeEach(() => {
      const now = new Date()
      const future = new Date(now.getTime() + 10 * 60 * 1000) // 10 minutes from now

      mockDb.query.verification.findFirst.mockResolvedValue({
        id: 'verification-123',
        identifier: `tenant-otp:${mockWorkspaceId}:${mockEmail}`,
        value: mockCode,
        expiresAt: future,
        createdAt: now,
      })

      mockDb.query.user.findFirst.mockResolvedValue({
        id: mockUserId,
        email: mockEmail,
        workspaceId: mockWorkspaceId,
        name: 'Test User',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const mockInsertChain = {
        values: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.insert.mockReturnValue(mockInsertChain)
    })

    it('should successfully verify code for existing user', async () => {
      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.action).toBe('login')
      expect(data.redirectUrl).toContain('/api/auth/trust-login?token=')
    })

    it('should delete verification code after successful verification (one-time use)', async () => {
      await POST(mockRequest)

      expect(mockDb.delete).toHaveBeenCalled()
      const mockDeleteChain = mockDb.delete.mock.results[0].value
      expect(mockDeleteChain.where).toHaveBeenCalled()
    })

    it('should create session transfer token with correct expiry (30 seconds)', async () => {
      const beforeTime = Date.now()
      await POST(mockRequest)
      const afterTime = Date.now()

      expect(mockDb.insert).toHaveBeenCalled()
      const mockInsertChain = mockDb.insert.mock.results[0].value
      expect(mockInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          targetDomain: mockHost,
          callbackUrl: '/',
          context: 'portal',
          expiresAt: expect.any(Date),
        })
      )

      // Verify expiry is approximately 30 seconds from now
      const insertCall = mockInsertChain.values.mock.calls[0][0]
      const expiryTime = insertCall.expiresAt.getTime()
      expect(expiryTime).toBeGreaterThanOrEqual(beforeTime + 29000)
      expect(expiryTime).toBeLessThanOrEqual(afterTime + 31000)
    })

    it('should include popup flag in redirect URL when popup is true', async () => {
      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        popup: true,
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(data.redirectUrl).toContain('popup=true')
    })

    it('should not include popup flag when popup is false', async () => {
      const response = await POST(mockRequest)
      const data = await response.json()

      expect(data.redirectUrl).not.toContain('popup=true')
    })

    it('should normalize email to lowercase', async () => {
      mockRequest.json = vi.fn().mockResolvedValue({
        email: 'Test@EXAMPLE.COM',
        code: mockCode,
      })

      await POST(mockRequest)

      expect(mockDb.query.user.findFirst).toHaveBeenCalled()
    })
  })

  describe('Valid Code Verification - Signup Flow', () => {
    beforeEach(() => {
      const now = new Date()
      const future = new Date(now.getTime() + 10 * 60 * 1000)

      mockDb.query.verification.findFirst.mockResolvedValue({
        id: 'verification-123',
        identifier: `tenant-otp:${mockWorkspaceId}:${mockEmail}`,
        value: mockCode,
        expiresAt: future,
        createdAt: now,
      })

      mockDb.query.user.findFirst.mockResolvedValue(null) // No existing user
    })

    it('should return needsSignup when user does not exist and no name provided', async () => {
      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.update.mockReturnValue(mockUpdateChain)

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.action).toBe('needsSignup')
      expect(data.email).toBe(mockEmail)
    })

    it('should extend verification expiry when returning needsSignup', async () => {
      const originalExpiry = new Date(Date.now() + 10 * 60 * 1000)
      mockDb.query.verification.findFirst.mockResolvedValue({
        id: 'verification-123',
        identifier: `tenant-otp:${mockWorkspaceId}:${mockEmail}`,
        value: mockCode,
        expiresAt: originalExpiry,
        createdAt: new Date(),
      })

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.update.mockReturnValue(mockUpdateChain)

      await POST(mockRequest)

      expect(mockDb.update).toHaveBeenCalled()
      expect(mockUpdateChain.set).toHaveBeenCalledWith({
        expiresAt: expect.any(Date),
      })

      // Verify expiry was extended by 5 minutes from original expiry
      const setCall = mockUpdateChain.set.mock.calls[0][0]
      const newExpiry = setCall.expiresAt.getTime()
      const expectedExpiry = originalExpiry.getTime() + 5 * 60 * 1000
      expect(Math.abs(newExpiry - expectedExpiry)).toBeLessThan(100) // Allow 100ms tolerance
    })
  })

  describe('Signup with Name Provided', () => {
    beforeEach(() => {
      const now = new Date()
      const future = new Date(now.getTime() + 10 * 60 * 1000)

      mockDb.query.verification.findFirst.mockResolvedValue({
        id: 'verification-123',
        identifier: `tenant-otp:${mockWorkspaceId}:${mockEmail}`,
        value: mockCode,
        expiresAt: future,
        createdAt: now,
      })

      mockDb.query.user.findFirst.mockResolvedValue(null)
      mockDb.query.invitation.findFirst.mockResolvedValue(null)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      mockDb.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return callback(mockTx)
      })
    })

    it('should create user, account, and member when name is provided', async () => {
      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        context: 'portal',
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.action).toBe('signup')
      expect(mockDb.transaction).toHaveBeenCalled()
    })

    it('should create user with correct fields', async () => {
      let capturedUserValues: Record<string, unknown> | undefined

      mockDb.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn((_table) => ({
            values: vi.fn((vals) => {
              // Capture first insert (user)
              if (!capturedUserValues) {
                capturedUserValues = vals
              }
              return Promise.resolve(undefined)
            }),
          })),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return callback(mockTx)
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
      })

      await POST(mockRequest)

      expect(capturedUserValues).toMatchObject({
        workspaceId: mockWorkspaceId,
        name: 'John Doe',
        email: mockEmail,
        emailVerified: true,
      })
    })

    it('should create account with providerId "otp"', async () => {
      let capturedAccountValues: Record<string, unknown> | undefined
      let insertCount = 0

      mockDb.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn((_table) => ({
            values: vi.fn((vals) => {
              insertCount++
              // Capture second insert (account)
              if (insertCount === 2) {
                capturedAccountValues = vals
              }
              return Promise.resolve(undefined)
            }),
          })),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return callback(mockTx)
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
      })

      await POST(mockRequest)

      expect(capturedAccountValues!.providerId).toBe('otp')
    })

    it('should create member with role "user" for portal context', async () => {
      let capturedMemberValues: Record<string, unknown> | undefined
      let insertCount = 0

      mockDb.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn((_table) => ({
            values: vi.fn((vals) => {
              insertCount++
              // Capture third insert (member)
              if (insertCount === 3) {
                capturedMemberValues = vals
              }
              return Promise.resolve(undefined)
            }),
          })),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return callback(mockTx)
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        context: 'portal',
      })

      await POST(mockRequest)

      expect(capturedMemberValues!.role).toBe('user')
    })

    it('should create member with role "member" for team context when openSignup enabled', async () => {
      mockDb.query.workspaceDomain.findFirst.mockResolvedValue({
        domain: mockHost,
        workspace: {
          id: mockWorkspaceId,
          slug: 'acme',
          name: 'Acme Corp',
        },
      })

      // Enable open signup via auth config
      mockGetAuthConfig.mockResolvedValue({
        success: true,
        value: {
          oauth: { google: true, github: true, microsoft: false },
          ssoRequired: false,
          openSignup: true,
        },
      })

      let capturedMemberValues: Record<string, unknown> | undefined
      let insertCount = 0

      mockDb.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn((_table) => ({
            values: vi.fn((vals) => {
              insertCount++
              // Capture third insert (member)
              if (insertCount === 3) {
                capturedMemberValues = vals
              }
              return Promise.resolve(undefined)
            }),
          })),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return callback(mockTx)
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        context: 'team',
      })

      await POST(mockRequest)

      expect(capturedMemberValues!.role).toBe('member')
    })

    it('should delete verification code after successful signup', async () => {
      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
      })

      await POST(mockRequest)

      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('should trim name before saving', async () => {
      let capturedUserValues: Record<string, unknown> | undefined

      mockDb.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn((_table) => ({
            values: vi.fn((vals) => {
              if (!capturedUserValues) {
                capturedUserValues = vals
              }
              return Promise.resolve(undefined)
            }),
          })),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return callback(mockTx)
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: '  John Doe  ',
      })

      await POST(mockRequest)

      expect(capturedUserValues!.name).toBe('John Doe')
    })
  })

  describe('Invalid Code Rejection', () => {
    it('should reject invalid code', async () => {
      const now = new Date()
      const future = new Date(now.getTime() + 10 * 60 * 1000)

      mockDb.query.verification.findFirst.mockResolvedValue({
        id: 'verification-123',
        identifier: `tenant-otp:${mockWorkspaceId}:${mockEmail}`,
        value: '654321', // Different code
        expiresAt: future,
        createdAt: now,
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid code')
    })

    it('should trim code before comparison', async () => {
      const now = new Date()
      const future = new Date(now.getTime() + 10 * 60 * 1000)

      mockDb.query.verification.findFirst.mockResolvedValue({
        id: 'verification-123',
        identifier: `tenant-otp:${mockWorkspaceId}:${mockEmail}`,
        value: '123456',
        expiresAt: future,
        createdAt: now,
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: '  123456  ',
      })

      mockDb.query.user.findFirst.mockResolvedValue({
        id: mockUserId,
        email: mockEmail,
        workspaceId: mockWorkspaceId,
      })

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const mockInsertChain = {
        values: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.insert.mockReturnValue(mockInsertChain)

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  describe('Expired Code Rejection', () => {
    it('should reject expired code', async () => {
      // Expired codes are filtered by gt(expiresAt) in the query
      mockDb.query.verification.findFirst.mockResolvedValue(null)

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Code expired or not found')
    })

    it('should return error when verification record not found', async () => {
      mockDb.query.verification.findFirst.mockResolvedValue(null)

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Code expired or not found')
    })
  })

  describe('Invitation Flow', () => {
    beforeEach(() => {
      const now = new Date()
      const future = new Date(now.getTime() + 10 * 60 * 1000)

      mockDb.query.verification.findFirst.mockResolvedValue({
        id: 'verification-123',
        identifier: `tenant-otp:${mockWorkspaceId}:${mockEmail}`,
        value: mockCode,
        expiresAt: future,
        createdAt: now,
      })

      mockDb.query.user.findFirst.mockResolvedValue(null)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)
    })

    it('should use role from invitation when provided', async () => {
      mockDb.query.invitation.findFirst.mockResolvedValue({
        id: 'invitation-123',
        email: mockEmail,
        workspaceId: mockWorkspaceId,
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })

      let capturedMemberValues: Record<string, unknown> | undefined
      let insertCount = 0

      mockDb.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn((_table) => ({
            values: vi.fn((vals) => {
              insertCount++
              // Capture third insert (member)
              if (insertCount === 3) {
                capturedMemberValues = vals
              }
              return Promise.resolve(undefined)
            }),
          })),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return callback(mockTx)
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        invitationId: 'invitation-123',
      })

      await POST(mockRequest)

      expect(capturedMemberValues!.role).toBe('admin')
    })

    it('should mark invitation as accepted', async () => {
      mockDb.query.invitation.findFirst.mockResolvedValue({
        id: 'invitation-123',
        email: mockEmail,
        workspaceId: mockWorkspaceId,
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })

      let capturedUpdateValues: Record<string, unknown> | undefined

      mockDb.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn((_table) => ({
            values: vi.fn((_vals) => {
              return Promise.resolve(undefined)
            }),
          })),
          update: vi.fn().mockReturnValue({
            set: vi.fn((vals) => {
              capturedUpdateValues = vals
              return {
                where: vi.fn().mockResolvedValue(undefined),
              }
            }),
          }),
        }
        return callback(mockTx)
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        invitationId: 'invitation-123',
      })

      await POST(mockRequest)

      expect(capturedUpdateValues!.status).toBe('accepted')
    })

    it('should reject invitation for different workspace', async () => {
      mockDb.query.invitation.findFirst.mockResolvedValue({
        id: 'invitation-123',
        email: mockEmail,
        workspaceId: 'different-org',
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        invitationId: 'invitation-123',
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('This invitation is for a different workspace')
    })

    it('should reject non-pending invitation', async () => {
      mockDb.query.invitation.findFirst.mockResolvedValue({
        id: 'invitation-123',
        email: mockEmail,
        workspaceId: mockWorkspaceId,
        role: 'admin',
        status: 'accepted',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        invitationId: 'invitation-123',
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('This invitation has already been used or cancelled')
    })

    it('should reject expired invitation', async () => {
      mockDb.query.invitation.findFirst.mockResolvedValue({
        id: 'invitation-123',
        email: mockEmail,
        workspaceId: mockWorkspaceId,
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        invitationId: 'invitation-123',
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('This invitation has expired. Please request a new one.')
    })

    it('should reject invitation with mismatched email', async () => {
      mockDb.query.invitation.findFirst.mockResolvedValue({
        id: 'invitation-123',
        email: 'different@example.com',
        workspaceId: mockWorkspaceId,
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        invitationId: 'invitation-123',
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe(
        'Email does not match the invitation. Please use the invited email address.'
      )
    })

    it('should reject invalid invitation ID', async () => {
      mockDb.query.invitation.findFirst.mockResolvedValue(null)

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        invitationId: 'invalid-invitation',
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid invitation')
    })
  })

  describe('Team Context without Invitation', () => {
    beforeEach(() => {
      const now = new Date()
      const future = new Date(now.getTime() + 10 * 60 * 1000)

      mockDb.query.verification.findFirst.mockResolvedValue({
        id: 'verification-123',
        identifier: `tenant-otp:${mockWorkspaceId}:${mockEmail}`,
        value: mockCode,
        expiresAt: future,
        createdAt: now,
      })

      mockDb.query.user.findFirst.mockResolvedValue(null)
      mockDb.query.invitation.findFirst.mockResolvedValue(null)
    })

    it('should reject team context signup when openSignup is false', async () => {
      mockDb.query.workspaceDomain.findFirst.mockResolvedValue({
        domain: mockHost,
        workspace: {
          id: mockWorkspaceId,
          slug: 'acme',
          name: 'Acme Corp',
        },
      })

      // openSignup disabled via auth config (default)
      mockGetAuthConfig.mockResolvedValue({
        success: true,
        value: {
          oauth: { google: true, github: true, microsoft: false },
          ssoRequired: false,
          openSignup: false,
        },
      })

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        context: 'team',
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe(
        'Signup is not enabled for this workspace. Contact your administrator.'
      )
    })

    it('should allow team context signup when openSignup is true', async () => {
      mockDb.query.workspaceDomain.findFirst.mockResolvedValue({
        domain: mockHost,
        workspace: {
          id: mockWorkspaceId,
          slug: 'acme',
          name: 'Acme Corp',
        },
      })

      // openSignup enabled via auth config
      mockGetAuthConfig.mockResolvedValue({
        success: true,
        value: {
          oauth: { google: true, github: true, microsoft: false },
          ssoRequired: false,
          openSignup: true,
        },
      })

      mockDb.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return callback(mockTx)
      })

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        context: 'team',
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.action).toBe('signup')
    })

    it('should allow portal context signup regardless of openSignup', async () => {
      mockDb.query.workspaceDomain.findFirst.mockResolvedValue({
        domain: mockHost,
        workspace: {
          id: mockWorkspaceId,
          slug: 'acme',
          name: 'Acme Corp',
        },
      })

      // openSignup disabled via auth config (shouldn't matter for portal context)
      mockGetAuthConfig.mockResolvedValue({
        success: true,
        value: {
          oauth: { google: true, github: true, microsoft: false },
          ssoRequired: false,
          openSignup: false,
        },
      })

      mockDb.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return callback(mockTx)
      })

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
        context: 'portal',
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  describe('Transaction Atomicity', () => {
    it('should rollback all operations if transaction fails', async () => {
      const now = new Date()
      const future = new Date(now.getTime() + 10 * 60 * 1000)

      mockDb.query.verification.findFirst.mockResolvedValue({
        id: 'verification-123',
        identifier: `tenant-otp:${mockWorkspaceId}:${mockEmail}`,
        value: mockCode,
        expiresAt: future,
        createdAt: now,
      })

      mockDb.query.user.findFirst.mockResolvedValue(null)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      mockDb.transaction.mockRejectedValue(new Error('Database error'))

      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: mockCode,
        name: 'John Doe',
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Something went wrong')
    })
  })

  describe('Input Validation', () => {
    it('should return 400 when host header is missing', async () => {
      const mockHeadersWithoutHost = new Headers({
        'x-forwarded-proto': 'http',
      })

      mockRequest = {
        headers: mockHeadersWithoutHost,
        json: vi.fn().mockResolvedValue({
          email: mockEmail,
          code: mockCode,
        }),
      } as unknown as NextRequest

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request')
    })

    it('should return 400 when workspace not found', async () => {
      mockDb.query.workspaceDomain.findFirst.mockResolvedValue(null)

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request')
    })

    it('should return 400 when email is missing', async () => {
      mockRequest.json = vi.fn().mockResolvedValue({
        code: mockCode,
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email is required')
    })

    it('should return 400 when email is not a string', async () => {
      mockRequest.json = vi.fn().mockResolvedValue({
        email: 12345,
        code: mockCode,
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email is required')
    })

    it('should return 400 when code is missing', async () => {
      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Code is required')
    })

    it('should return 400 when code is not a string', async () => {
      mockRequest.json = vi.fn().mockResolvedValue({
        email: mockEmail,
        code: 123456,
      })

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Code is required')
    })
  })

  describe('Error Handling', () => {
    it('should return 500 on unexpected errors', async () => {
      mockDb.query.workspaceDomain.findFirst.mockRejectedValue(
        new Error('Database connection failed')
      )

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Something went wrong')
    })
  })
})
