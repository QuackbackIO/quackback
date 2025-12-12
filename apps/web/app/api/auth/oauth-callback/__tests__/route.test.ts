import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { createHmac } from 'crypto'

// Type definitions for mocks
interface MockOrganization {
  id: string
  slug: string
  name: string
  logo: null
  logoBlob: null
  logoType: null
  createdAt: Date
  metadata: null
}

interface MockUser {
  id: string
  email: string
  organizationId: string
  name: string
  emailVerified: boolean
  image: null
  imageBlob: null
  imageType: null
  createdAt: Date
  updatedAt: Date
  metadata: null
}

interface MockBetterAuthSession {
  session: {
    id: string
    createdAt: Date
    updatedAt: Date
    userId: string
    expiresAt: Date
    token: string
    ipAddress: null
    userAgent: null
  }
  user: {
    id: string
    email?: string
    name?: string
    image?: string
    createdAt: Date
    updatedAt: Date
    emailVerified: boolean
  }
}

interface MockTransactionContext {
  insert: ReturnType<typeof vi.fn>
}

// Mock modules
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('@quackback/db', () => ({
  db: {
    query: {
      organization: {
        findFirst: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(),
    })),
    transaction: vi.fn(),
  },
  sessionTransferToken: 'sessionTransferToken',
  user: 'user',
  account: 'account',
  member: 'member',
  organization: {
    slug: 'slug',
  },
  eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
  and: vi.fn((...conditions) => ({ conditions, op: 'and' })),
}))

vi.mock('@/lib/routing', () => ({
  getBaseDomain: vi.fn((host: string) => {
    if (host.includes('localhost')) {
      return host.includes(':') ? 'localhost:3000' : 'localhost'
    }
    const parts = host.split('.')
    return parts.slice(-2).join('.')
  }),
}))

// Import mocked modules after setup
import { auth } from '@/lib/auth'
import { db } from '@quackback/db'

// Mock factory functions for consistent test data
function createMockOrganization(data: {
  id: string
  slug: string
  name: string
}): MockOrganization {
  return {
    ...data,
    logo: null,
    logoBlob: null,
    logoType: null,
    createdAt: new Date(),
    metadata: null,
  }
}

function createMockUser(data: {
  id: string
  email: string
  organizationId: string
  name: string
}): MockUser {
  return {
    ...data,
    emailVerified: false,
    image: null,
    imageBlob: null,
    imageType: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: null,
  }
}

function createMockBetterAuthSession(data: {
  session: { id: string }
  user: { id: string; email?: string; name?: string; image?: string }
}): MockBetterAuthSession {
  const userMock: MockBetterAuthSession['user'] = {
    id: data.user.id,
    createdAt: new Date(),
    updatedAt: new Date(),
    emailVerified: true,
  }

  // Only set email if provided
  if (data.user.email !== undefined) {
    userMock.email = data.user.email
  }

  // Only set image if provided (don't default to null)
  if (data.user.image !== undefined) {
    userMock.image = data.user.image
  }

  // Only set name if provided (don't default)
  if (data.user.name !== undefined) {
    userMock.name = data.user.name
  }

  return {
    session: {
      id: data.session.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: data.user.id,
      expiresAt: new Date(Date.now() + 86400000), // 24 hours
      token: 'mock-session-token',
      ipAddress: null,
      userAgent: null,
    },
    user: userMock,
  }
}

// Helper to create signed OAuth state
function createSignedState(payload: Record<string, unknown>, secret: string): string {
  const payloadStr = JSON.stringify(payload)
  const signature = createHmac('sha256', secret).update(payloadStr).digest('hex')
  return JSON.stringify({ payload: payloadStr, signature })
}

// Helper to create request with cookies and headers
function createRequest(
  url: string,
  cookies: Record<string, string> = {},
  headers: Record<string, string> = {}
): NextRequest {
  const request = new NextRequest(new URL(url))

  // Mock cookies
  const cookieStore = {
    get: (name: string) => {
      const value = cookies[name]
      return value ? { name, value } : undefined
    },
    delete: vi.fn(),
  }

  // Override cookies property
  Object.defineProperty(request, 'cookies', {
    get: () => cookieStore,
  })

  // Add headers
  Object.entries(headers).forEach(([key, value]) => {
    request.headers.set(key, value)
  })

  return request
}

describe('OAuth Callback Handler', () => {
  const mockSecret = 'test-secret-key-for-hmac-validation'
  const mockOrgId = 'org-123'
  const mockUserId = 'user-456'
  const mockEmail = 'test@example.com'

  beforeEach(() => {
    // Set environment variable
    process.env.BETTER_AUTH_SECRET = mockSecret

    // Reset mocks
    vi.clearAllMocks()

    // Mock crypto.randomUUID
    let uuidCounter = 0
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `uuid-${++uuidCounter}`)

    // Mock crypto.getRandomValues for token generation
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const uint8Array = array as Uint8Array
      for (let i = 0; i < uint8Array.length; i++) {
        uint8Array[i] = i % 256
      }
      return uint8Array
    })
  })

  afterEach(() => {
    delete process.env.BETTER_AUTH_SECRET
    vi.restoreAllMocks()
  })

  describe('HMAC Signature Verification', () => {
    it('accepts valid HMAC signatures', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
        popup: false,
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      // Mock successful auth session
      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      // Mock organization lookup
      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      // Mock existing user lookup (user doesn't exist)
      vi.mocked(db.query.user.findFirst).mockResolvedValue(undefined)

      // Mock transaction
      vi.mocked(db.transaction).mockImplementation(async (cb) => {
        return await cb(db as unknown as MockTransactionContext)
      })

      const response = await GET(request)

      expect(response.status).toBe(307) // redirect
      expect(response.headers.get('location')).toContain('acme.localhost:3000')
      expect(response.headers.get('location')).toContain('/api/auth/trust-login')
    })

    it('rejects tampered HMAC signatures', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const payloadStr = JSON.stringify(payload)
      const validSignature = createHmac('sha256', mockSecret).update(payloadStr).digest('hex')

      // Tamper with signature
      const tamperedSignature = validSignature.slice(0, -2) + 'ff'
      const tamperedState = JSON.stringify({
        payload: payloadStr,
        signature: tamperedSignature,
      })

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: tamperedState },
        { host: 'localhost:3000' }
      )

      const response = await GET(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('error=oauth_invalid_signature')
    })

    it('rejects signatures with wrong length', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const payloadStr = JSON.stringify(payload)
      const shortSignature = 'abc123'

      const invalidState = JSON.stringify({
        payload: payloadStr,
        signature: shortSignature,
      })

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: invalidState },
        { host: 'localhost:3000' }
      )

      const response = await GET(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('error=oauth_invalid_signature')
    })
  })

  describe('Timestamp Validation', () => {
    it('accepts timestamps within 5-minute window', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now() - 4 * 60 * 1000, // 4 minutes ago
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(undefined)

      vi.mocked(db.transaction).mockImplementation(async (cb) => {
        return await cb(db as unknown as MockTransactionContext)
      })

      const response = await GET(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).not.toContain('error=oauth_expired')
    })

    it('rejects expired timestamps (over 5 minutes)', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      const response = await GET(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('error=oauth_expired')
    })

    it('rejects timestamps exactly at 5-minute boundary', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now() - 5 * 60 * 1000 - 1, // 5 minutes + 1ms ago
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      const response = await GET(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('error=oauth_expired')
    })
  })

  describe('Subdomain Format Validation', () => {
    it('accepts valid subdomain formats', async () => {
      const validSubdomains = ['acme', 'my-org', 'test123', 'a-b-c']

      for (const subdomain of validSubdomains) {
        const payload = {
          subdomain,
          context: 'portal',
          timestamp: Date.now(),
          provider: 'github',
        }
        const signedState = createSignedState(payload, mockSecret)

        const request = createRequest(
          'http://localhost:3000/api/auth/oauth-callback',
          { oauth_target: signedState },
          { host: 'localhost:3000' }
        )

        vi.mocked(auth.api.getSession).mockResolvedValue(
          createMockBetterAuthSession({
            session: { id: 'session-1' },
            user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
          })
        )

        vi.mocked(db.query.organization.findFirst).mockResolvedValue(
          createMockOrganization({
            id: mockOrgId,
            slug: subdomain,
            name: 'Test Org',
          })
        )

        vi.mocked(db.query.user.findFirst).mockResolvedValue(undefined)

        vi.mocked(db.transaction).mockImplementation(async (cb) => {
          return await cb(db as unknown as MockTransactionContext)
        })

        const response = await GET(request)

        expect(response.status).toBe(307)
        expect(response.headers.get('location')).not.toContain('error=oauth_invalid_subdomain')
      }
    })

    it('rejects invalid subdomain formats', async () => {
      const invalidSubdomains = [
        '',
        'Acme', // uppercase
        'acme_org', // underscore
        'acme.org', // dot
        'acme org', // space
        'acme@org', // special char
      ]

      for (const subdomain of invalidSubdomains) {
        const payload = {
          subdomain,
          context: 'portal',
          timestamp: Date.now(),
          provider: 'github',
        }
        const signedState = createSignedState(payload, mockSecret)

        const request = createRequest(
          'http://localhost:3000/api/auth/oauth-callback',
          { oauth_target: signedState },
          { host: 'localhost:3000' }
        )

        const response = await GET(request)

        expect(response.status).toBe(307)
        expect(response.headers.get('location')).toContain('error=oauth_invalid_subdomain')
      }
    })
  })

  describe('Existing User Login Flow', () => {
    it('finds existing user and creates transfer token', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      // Mock existing user
      vi.mocked(db.query.user.findFirst).mockResolvedValue(
        createMockUser({
          id: mockUserId,
          email: mockEmail,
          organizationId: mockOrgId,
          name: 'Test User',
        })
      )

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn(),
      })
      vi.mocked(db.insert).mockImplementation(mockInsert)

      const response = await GET(request)

      // Verify transfer token was created with existing user ID
      expect(mockInsert).toHaveBeenCalledWith('sessionTransferToken')
      const valuesCall = mockInsert.mock.results[0].value.values
      expect(valuesCall).toHaveBeenCalled()
      const tokenData = valuesCall.mock.calls[0][0]
      expect(tokenData.userId).toBe(mockUserId)
      expect(tokenData.targetDomain).toBe('acme.localhost:3000')
      expect(tokenData.callbackUrl).toBe('/')
      expect(tokenData.context).toBe('portal')

      // Verify redirect
      expect(response.status).toBe(307)
      const location = response.headers.get('location')
      expect(location).toContain('acme.localhost:3000')
      expect(location).toContain('/api/auth/trust-login')
      expect(location).toContain('token=')
    })

    it('does not create new user record for existing users', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'team',
        timestamp: Date.now(),
        provider: 'google',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(
        createMockUser({
          id: mockUserId,
          email: mockEmail,
          organizationId: mockOrgId,
          name: 'Test User',
        })
      )

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn(),
      })
      vi.mocked(db.insert).mockImplementation(mockInsert)

      await GET(request)

      // Verify transaction was NOT called (no user creation needed)
      expect(db.transaction).not.toHaveBeenCalled()
    })
  })

  describe('New User Signup Flow', () => {
    it('creates new user with correct role for portal context', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: {
            id: 'ba-user-1',
            email: mockEmail,
            name: 'New User',
            image: 'https://example.com/avatar.jpg',
          },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      // Mock no existing user
      vi.mocked(db.query.user.findFirst).mockResolvedValue(undefined)

      let capturedUserData: Record<string, unknown> | undefined
      let capturedAccountData: Record<string, unknown> | undefined
      let capturedMemberData: Record<string, unknown> | undefined

      vi.mocked(db.transaction).mockImplementation(async (cb) => {
        const mockTx = {
          insert: vi.fn((table) => ({
            values: vi.fn((data) => {
              if (table === 'user') capturedUserData = data
              if (table === 'account') capturedAccountData = data
              if (table === 'member') capturedMemberData = data
            }),
          })),
        }
        return await cb(mockTx as MockTransactionContext)
      })

      await GET(request)

      // Verify user creation
      expect(capturedUserData).toMatchObject({
        organizationId: mockOrgId,
        email: mockEmail,
        name: 'New User',
        emailVerified: true,
        image: 'https://example.com/avatar.jpg',
      })

      // Verify account creation
      expect(capturedAccountData).toMatchObject({
        accountId: mockEmail,
        providerId: 'github',
      })

      // Verify member creation with 'user' role (portal context)
      expect(capturedMemberData).toMatchObject({
        organizationId: mockOrgId,
        role: 'user',
      })
    })

    it('creates new user with member role for team context', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'team',
        timestamp: Date.now(),
        provider: 'google',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Team User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(undefined)

      let capturedMemberData: Record<string, unknown> | undefined

      vi.mocked(db.transaction).mockImplementation(async (cb) => {
        const mockTx = {
          insert: vi.fn((table) => ({
            values: vi.fn((data) => {
              if (table === 'member') capturedMemberData = data
            }),
          })),
        }
        return await cb(mockTx as MockTransactionContext)
      })

      await GET(request)

      // Verify member creation with 'member' role (team context)
      expect(capturedMemberData).toMatchObject({
        organizationId: mockOrgId,
        role: 'member',
      })
    })

    it('uses email as name when name is not provided', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail }, // no name
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(undefined)

      let capturedUserData: Record<string, unknown> | undefined

      vi.mocked(db.transaction).mockImplementation(async (cb) => {
        const mockTx = {
          insert: vi.fn((table) => ({
            values: vi.fn((data) => {
              if (table === 'user') capturedUserData = data
            }),
          })),
        }
        return await cb(mockTx as MockTransactionContext)
      })

      await GET(request)

      // Verify email is used as name
      expect(capturedUserData.name).toBe(mockEmail)
    })
  })

  describe('Transfer Token Creation', () => {
    it('creates transfer token with correct domain and expiry', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(
        createMockUser({
          id: mockUserId,
          email: mockEmail,
          organizationId: mockOrgId,
          name: 'Test User',
        })
      )

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn(),
      })
      vi.mocked(db.insert).mockImplementation(mockInsert)

      const beforeTime = Date.now()
      await GET(request)
      const afterTime = Date.now()

      const valuesCall = mockInsert.mock.results[0].value.values
      const tokenData = valuesCall.mock.calls[0][0]

      // Verify token structure
      expect(tokenData.token).toBeDefined()
      expect(tokenData.token).toHaveLength(64) // 32 bytes in hex

      // Verify expiry is 30 seconds from now
      const expiryTime = new Date(tokenData.expiresAt).getTime()
      expect(expiryTime).toBeGreaterThanOrEqual(beforeTime + 30000)
      expect(expiryTime).toBeLessThanOrEqual(afterTime + 30000)

      // Verify target domain
      expect(tokenData.targetDomain).toBe('acme.localhost:3000')
    })

    it('sets correct callback URL based on context', async () => {
      const contexts = [
        { context: 'portal', expectedCallback: '/' },
        { context: 'team', expectedCallback: '/admin' },
      ]

      for (const { context, expectedCallback } of contexts) {
        const payload = {
          subdomain: 'acme',
          context,
          timestamp: Date.now(),
          provider: 'github',
        }
        const signedState = createSignedState(payload, mockSecret)

        const request = createRequest(
          'http://localhost:3000/api/auth/oauth-callback',
          { oauth_target: signedState },
          { host: 'localhost:3000' }
        )

        vi.mocked(auth.api.getSession).mockResolvedValue(
          createMockBetterAuthSession({
            session: { id: 'session-1' },
            user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
          })
        )

        vi.mocked(db.query.organization.findFirst).mockResolvedValue(
          createMockOrganization({
            id: mockOrgId,
            slug: 'acme',
            name: 'Acme Corp',
          })
        )

        vi.mocked(db.query.user.findFirst).mockResolvedValue(
          createMockUser({
            id: mockUserId,
            email: mockEmail,
            organizationId: mockOrgId,
            name: 'Test User',
          })
        )

        const mockInsert = vi.fn().mockReturnValue({
          values: vi.fn(),
        })
        vi.mocked(db.insert).mockImplementation(mockInsert)

        await GET(request)

        const valuesCall = mockInsert.mock.results[0].value.values
        const tokenData = valuesCall.mock.calls[0][0]

        expect(tokenData.callbackUrl).toBe(expectedCallback)
        expect(tokenData.context).toBe(context)

        vi.clearAllMocks()
      }
    })

    it('includes popup flag in redirect URL when present', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
        popup: true,
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(
        createMockUser({
          id: mockUserId,
          email: mockEmail,
          organizationId: mockOrgId,
          name: 'Test User',
        })
      )

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn(),
      })
      vi.mocked(db.insert).mockImplementation(mockInsert)

      const response = await GET(request)

      const location = response.headers.get('location')
      expect(location).toContain('popup=true')
    })

    it('omits popup flag when not present', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(
        createMockUser({
          id: mockUserId,
          email: mockEmail,
          organizationId: mockOrgId,
          name: 'Test User',
        })
      )

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn(),
      })
      vi.mocked(db.insert).mockImplementation(mockInsert)

      const response = await GET(request)

      const location = response.headers.get('location')
      expect(location).not.toContain('popup=')
    })
  })

  describe('Cookie Cleanup', () => {
    it('deletes oauth_target cookie after processing', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const _mockCookieDelete = vi.fn()
      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(
        createMockUser({
          id: mockUserId,
          email: mockEmail,
          organizationId: mockOrgId,
          name: 'Test User',
        })
      )

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn(),
      })
      vi.mocked(db.insert).mockImplementation(mockInsert)

      const response = await GET(request)

      // Check response cookie headers for deletion
      const setCookieHeaders = response.headers.getSetCookie()
      const hasOAuthTargetDeletion = setCookieHeaders.some(
        (cookie) =>
          cookie.includes('oauth_target') &&
          (cookie.includes('Max-Age=0') || cookie.includes('Expires='))
      )
      expect(hasOAuthTargetDeletion).toBe(true)
    })

    it('deletes better-auth.session_token cookie', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(
        createMockUser({
          id: mockUserId,
          email: mockEmail,
          organizationId: mockOrgId,
          name: 'Test User',
        })
      )

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn(),
      })
      vi.mocked(db.insert).mockImplementation(mockInsert)

      const response = await GET(request)

      // Check response cookie headers for deletion
      const setCookieHeaders = response.headers.getSetCookie()
      const hasSessionTokenDeletion = setCookieHeaders.some(
        (cookie) =>
          cookie.includes('better-auth.session_token') &&
          (cookie.includes('Max-Age=0') || cookie.includes('Expires='))
      )
      expect(hasSessionTokenDeletion).toBe(true)
    })
  })

  describe('Redirect URL Construction', () => {
    it('constructs correct redirect URL for localhost', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(
        createMockUser({
          id: mockUserId,
          email: mockEmail,
          organizationId: mockOrgId,
          name: 'Test User',
        })
      )

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn(),
      })
      vi.mocked(db.insert).mockImplementation(mockInsert)

      const response = await GET(request)

      const location = response.headers.get('location')
      expect(location).toContain('http://acme.localhost:3000/api/auth/trust-login')
      expect(location).toContain('token=')
    })

    it('uses x-forwarded-proto header for protocol', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://quackback.io/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'quackback.io', 'x-forwarded-proto': 'https' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(
        createMockUser({
          id: mockUserId,
          email: mockEmail,
          organizationId: mockOrgId,
          name: 'Test User',
        })
      )

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn(),
      })
      vi.mocked(db.insert).mockImplementation(mockInsert)

      const response = await GET(request)

      const location = response.headers.get('location')
      expect(location).toContain('https://acme.quackback.io/api/auth/trust-login')
    })

    it('includes token in redirect URL query string', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      vi.mocked(db.query.user.findFirst).mockResolvedValue(
        createMockUser({
          id: mockUserId,
          email: mockEmail,
          organizationId: mockOrgId,
          name: 'Test User',
        })
      )

      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn(),
      })
      vi.mocked(db.insert).mockImplementation(mockInsert)

      const response = await GET(request)

      const location = response.headers.get('location')!
      const url = new URL(location)
      expect(url.searchParams.has('token')).toBe(true)
      expect(url.searchParams.get('token')).toHaveLength(64)
    })
  })

  describe('Error Handling', () => {
    it('returns error when BETTER_AUTH_SECRET is not set', async () => {
      delete process.env.BETTER_AUTH_SECRET

      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, 'any-secret')

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      const response = await GET(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('error=server_config')
    })

    it('returns error when oauth_target cookie is missing', async () => {
      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        {}, // no cookies
        { host: 'localhost:3000' }
      )

      const response = await GET(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('error=oauth_missing_target')
    })

    it('returns error when oauth_target is not valid JSON', async () => {
      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: 'not-json' },
        { host: 'localhost:3000' }
      )

      const response = await GET(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('error=oauth_invalid_state')
    })

    it('returns error when payload is missing', async () => {
      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: JSON.stringify({ signature: 'abc' }) },
        { host: 'localhost:3000' }
      )

      const response = await GET(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('error=oauth_invalid_state')
    })

    it('returns error when signature is missing', async () => {
      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: JSON.stringify({ payload: '{}' }) },
        { host: 'localhost:3000' }
      )

      const response = await GET(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('error=oauth_invalid_state')
    })

    it('redirects to subdomain error when session is missing', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(null)

      const response = await GET(request)

      expect(response.status).toBe(307)
      const location = response.headers.get('location')
      expect(location).toContain('acme.localhost:3000/login')
      expect(location).toContain('error=oauth_failed')
    })

    it('redirects to subdomain error when organization not found', async () => {
      const payload = {
        subdomain: 'nonexistent',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', email: mockEmail, name: 'Test User' },
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(undefined)

      const response = await GET(request)

      expect(response.status).toBe(307)
      const location = response.headers.get('location')
      expect(location).toContain('nonexistent.localhost:3000/login')
      expect(location).toContain('error=org_not_found')
    })

    it('redirects to subdomain error when user has no email', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockResolvedValue(
        createMockBetterAuthSession({
          session: { id: 'session-1' },
          user: { id: 'ba-user-1', name: 'Test User' }, // no email
        })
      )

      vi.mocked(db.query.organization.findFirst).mockResolvedValue(
        createMockOrganization({
          id: mockOrgId,
          slug: 'acme',
          name: 'Acme Corp',
        })
      )

      const response = await GET(request)

      expect(response.status).toBe(307)
      const location = response.headers.get('location')
      expect(location).toContain('acme.localhost:3000/login')
      expect(location).toContain('error=oauth_no_email')
    })

    it('handles unexpected errors gracefully', async () => {
      const payload = {
        subdomain: 'acme',
        context: 'portal',
        timestamp: Date.now(),
        provider: 'github',
      }
      const signedState = createSignedState(payload, mockSecret)

      const request = createRequest(
        'http://localhost:3000/api/auth/oauth-callback',
        { oauth_target: signedState },
        { host: 'localhost:3000' }
      )

      vi.mocked(auth.api.getSession).mockRejectedValue(new Error('Database error'))

      const response = await GET(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('error=oauth_error')
    })
  })
})
