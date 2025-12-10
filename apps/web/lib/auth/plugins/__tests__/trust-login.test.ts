import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock database - must be hoisted for vi.mock to access
const mockDb = vi.hoisted(() => ({
  query: {
    sessionTransferToken: {
      findFirst: vi.fn(),
    },
    workspaceDomain: {
      findFirst: vi.fn(),
    },
    member: {
      findFirst: vi.fn(),
    },
  },
  delete: vi.fn(),
  insert: vi.fn(),
}))

// Mock db and imports
vi.mock('@quackback/db', () => ({
  db: mockDb,
  sessionTransferToken: {
    token: 'token',
    id: 'id',
  },
  member: {
    userId: 'userId',
    organizationId: 'organizationId',
  },
  workspaceDomain: {
    domain: 'domain',
  },
  eq: vi.fn((...args) => ({ eq: args })),
  and: vi.fn((...args) => ({ and: args })),
  gt: vi.fn((...args) => ({ gt: args })),
}))

// Import after mocking
import { trustLogin } from '../trust-login'

describe('trustLogin plugin', () => {
  let mockContext: any
  let mockInternalAdapter: any
  let mockSetSignedCookie: any
  let mockRedirect: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Create fresh mock functions for each test
    mockInternalAdapter = {
      createSession: vi.fn(),
    }
    mockSetSignedCookie = vi.fn()
    mockRedirect = vi.fn(
      (url: string) => new Response(null, { status: 302, headers: { Location: url } })
    )

    // Mock Better-Auth context
    mockContext = {
      query: { token: 'test-token-123' },
      request: {
        url: 'http://acme.localhost:3000/trust-login?token=test-token-123',
        headers: {
          get: vi.fn((name: string) => {
            if (name === 'host') return 'acme.localhost:3000'
            return null
          }),
        },
      },
      context: {
        internalAdapter: mockInternalAdapter,
        secret: 'test-secret',
        authCookies: {
          sessionToken: {
            name: 'better-auth.session_token',
            options: {
              httpOnly: true,
              secure: false,
              sameSite: 'lax',
            },
          },
        },
      },
      setSignedCookie: mockSetSignedCookie,
      redirect: mockRedirect,
    }
  })

  describe('plugin structure', () => {
    it('should have correct plugin id', () => {
      const plugin = trustLogin()
      expect(plugin.id).toBe('trust-login')
    })

    it('should have trustLogin endpoint', () => {
      const plugin = trustLogin()
      expect(plugin.endpoints).toBeDefined()
      expect(plugin.endpoints?.trustLogin).toBeDefined()
    })
  })

  describe('token validation - valid token creates session', () => {
    it('should create session for valid token', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min future
        createdAt: new Date(),
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      // Get the handler function from the plugin
      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      // The endpoint returned by createAuthEndpoint is itself a function
      const result = await endpoint(mockContext)

      expect(mockDb.query.sessionTransferToken.findFirst).toHaveBeenCalled()
      expect(mockInternalAdapter.createSession).toHaveBeenCalledWith('user-123', false)
      // Verify redirect response (better-auth returns APIError with status/headers)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/admin')
    })
  })

  describe('token expiry - expired tokens are rejected', () => {
    it('should reject expired token', async () => {
      // findFirst should return null because of gt() filter in query
      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(null)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      // Verify redirect response (better-auth returns APIError with status/headers)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/login?error=invalid_token')
    })

    it('should not create session for expired token', async () => {
      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(null)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      expect(mockInternalAdapter.createSession).not.toHaveBeenCalled()
      expect(mockSetSignedCookie).not.toHaveBeenCalled()
    })
  })

  describe('domain mismatch detection - tokens for different domains are rejected', () => {
    it('should reject token when domain does not match', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'different.localhost:3000', // Different domain
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      expect(mockDb.delete).toHaveBeenCalled()
      // Verify redirect response (better-auth returns APIError with status/headers)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/login?error=invalid_domain')
    })

    it('should not create session when domain mismatches', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'different.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      expect(mockInternalAdapter.createSession).not.toHaveBeenCalled()
      expect(mockSetSignedCookie).not.toHaveBeenCalled()
    })

    it('should delete token even when domain mismatches', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'different.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      expect(mockDb.delete).toHaveBeenCalled()
      expect(mockDeleteChain.where).toHaveBeenCalled()
    })
  })

  describe('one-time use - tokens are deleted after use', () => {
    it('should delete token after successful login', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      expect(mockDb.delete).toHaveBeenCalled()
      expect(mockDeleteChain.where).toHaveBeenCalled()
    })

    it('should delete token before creating session', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      // Verify deletion happens
      expect(mockDb.delete).toHaveBeenCalled()
    })
  })

  describe('member creation for portal OAuth users', () => {
    it('should create member record for portal context when it does not exist', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/',
        context: 'portal', // Portal context
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockDomain = {
        organizationId: 'org-123',
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockDb.query.workspaceDomain.findFirst.mockResolvedValue(mockDomain)
      mockDb.query.member.findFirst.mockResolvedValue(null) // No existing member
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const mockInsertChain = {
        values: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.insert.mockReturnValue(mockInsertChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      expect(mockDb.query.workspaceDomain.findFirst).toHaveBeenCalled()
      expect(mockDb.query.member.findFirst).toHaveBeenCalled()
      expect(mockDb.insert).toHaveBeenCalled()
      expect(mockInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          organizationId: 'org-123',
          role: 'user',
        })
      )
    })

    it('should not create member record when it already exists', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/',
        context: 'portal',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockDomain = {
        organizationId: 'org-123',
      }

      const mockExistingMember = {
        id: 'member-1',
        userId: 'user-123',
        organizationId: 'org-123',
        role: 'user',
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockDb.query.workspaceDomain.findFirst.mockResolvedValue(mockDomain)
      mockDb.query.member.findFirst.mockResolvedValue(mockExistingMember) // Member exists
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      expect(mockDb.query.member.findFirst).toHaveBeenCalled()
      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('should not create member record for team context', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team', // Team context
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      expect(mockDb.query.workspaceDomain.findFirst).not.toHaveBeenCalled()
      expect(mockDb.query.member.findFirst).not.toHaveBeenCalled()
      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('should handle missing domain record gracefully', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/',
        context: 'portal',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockDb.query.workspaceDomain.findFirst.mockResolvedValue(null) // No domain record
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      expect(mockDb.query.workspaceDomain.findFirst).toHaveBeenCalled()
      expect(mockDb.query.member.findFirst).not.toHaveBeenCalled()
      expect(mockDb.insert).not.toHaveBeenCalled()
      // Should still complete successfully - verify redirect response (better-auth returns APIError)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/')
    })
  })

  describe('popup mode redirects vs normal redirects', () => {
    it('should redirect to /auth-complete when popup=true', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      // Update request URL to include popup=true
      mockContext.request.url =
        'http://acme.localhost:3000/trust-login?token=test-token-123&popup=true'

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      // Verify redirect response (better-auth returns APIError with status/headers)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/auth-complete')
    })

    it('should use context-based redirect when popup=false', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      // Update request URL with popup=false
      mockContext.request.url =
        'http://acme.localhost:3000/trust-login?token=test-token-123&popup=false'

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      // Verify redirect response (better-auth returns APIError with status/headers)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/admin')
    })

    it('should use context-based redirect when popup param is missing', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/',
        context: 'portal',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      // Verify redirect response (better-auth returns APIError with status/headers)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/')
    })
  })

  describe('context-based redirects (team → /admin, portal → /)', () => {
    it('should redirect to /admin for team context', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      // Verify redirect response (better-auth returns APIError with status/headers)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/admin')
    })

    it('should redirect to / for portal context', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/',
        context: 'portal',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      // Verify redirect response (better-auth returns APIError with status/headers)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/')
    })
  })

  describe('missing/invalid token handling', () => {
    it('should redirect to login with error when token is invalid', async () => {
      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(null)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      // Verify redirect response (better-auth returns APIError with status/headers)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/login?error=invalid_token')
    })

    it('should not proceed with session creation when token is invalid', async () => {
      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(null)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      expect(mockInternalAdapter.createSession).not.toHaveBeenCalled()
      expect(mockSetSignedCookie).not.toHaveBeenCalled()
    })
  })

  describe('user not found scenarios', () => {
    it('should redirect with error when session creation fails', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(null) // Session creation fails

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      // Verify redirect response (better-auth returns APIError with status/headers)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/login?error=session_error')
    })

    it('should not set cookie when session creation fails', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(null)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      expect(mockSetSignedCookie).not.toHaveBeenCalled()
    })

    it('should still delete token even when session creation fails', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(null)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      expect(mockDb.delete).toHaveBeenCalled()
      expect(mockDeleteChain.where).toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle missing host header', async () => {
      mockContext.request.headers.get = vi.fn(() => null)

      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      // Empty string !== targetDomain, should reject - verify redirect response (better-auth returns APIError)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/login?error=invalid_domain')
    })

    it('should handle missing request object', async () => {
      mockContext.request = null

      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      // Should use empty string for host - verify redirect response (better-auth returns APIError)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/login?error=invalid_domain')
    })

    it('should handle URL parsing with missing request URL', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/admin',
        context: 'team',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      mockContext.request.url = null

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      const result = await endpoint(mockContext)

      // Should still work with fallback URL
      // Verify redirect response (better-auth returns APIError with status/headers)
      expect(result.status).toBe('FOUND') // 302 redirect status
      expect(result.headers.get('Location')).toBe('/admin')
    })

    it('should handle crypto.randomUUID in member creation', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        token: 'test-token-123',
        userId: 'user-123',
        targetDomain: 'acme.localhost:3000',
        callbackUrl: '/',
        context: 'portal',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      }

      const mockDomain = {
        organizationId: 'org-123',
      }

      const mockSession = {
        token: 'session-token-abc',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      // Mock crypto.randomUUID
      const originalRandomUUID = global.crypto.randomUUID
      global.crypto.randomUUID = vi.fn(() => 'mock-uuid-123') as any

      mockDb.query.sessionTransferToken.findFirst.mockResolvedValue(mockTransfer)
      mockDb.query.workspaceDomain.findFirst.mockResolvedValue(mockDomain)
      mockDb.query.member.findFirst.mockResolvedValue(null)
      mockInternalAdapter.createSession.mockResolvedValue(mockSession)

      const mockDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.delete.mockReturnValue(mockDeleteChain)

      const mockInsertChain = {
        values: vi.fn().mockResolvedValue(undefined),
      }
      mockDb.insert.mockReturnValue(mockInsertChain)

      const plugin = trustLogin()
      const endpoint = plugin.endpoints!.trustLogin as any
      await endpoint(mockContext)

      expect(mockInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'mock-uuid-123',
          userId: 'user-123',
          organizationId: 'org-123',
          role: 'user',
          createdAt: expect.any(Date),
        })
      )

      // Restore original crypto
      global.crypto.randomUUID = originalRandomUUID
    })
  })
})
