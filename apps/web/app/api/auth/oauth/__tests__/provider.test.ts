import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

// Mock organizationService - must be hoisted for vi.mock to access
const { mockGetPublicAuthConfig, mockGetPublicPortalConfig } = vi.hoisted(() => ({
  mockGetPublicAuthConfig: vi.fn(),
  mockGetPublicPortalConfig: vi.fn(),
}))

vi.mock('@quackback/domain', () => ({
  organizationService: {
    getPublicAuthConfig: mockGetPublicAuthConfig,
    getPublicPortalConfig: mockGetPublicPortalConfig,
  },
  DEFAULT_AUTH_CONFIG: {
    oauth: { google: false, github: false, microsoft: false },
    ssoRequired: false,
    openSignup: false,
  },
  DEFAULT_PORTAL_CONFIG: {
    oauth: { google: false, github: false },
    features: { publicView: true, submissions: true, comments: true, voting: true },
  },
}))

import { GET } from '../[provider]/route'

// Helper to set up mock config responses
function mockOrgConfigs(config: {
  authOAuth?: { google?: boolean; github?: boolean; microsoft?: boolean }
  portalOAuth?: { google?: boolean; github?: boolean }
  found?: boolean
}) {
  const { authOAuth, portalOAuth, found = true } = config

  if (found) {
    mockGetPublicAuthConfig.mockResolvedValue({
      success: true,
      value: {
        oauth: {
          google: authOAuth?.google ?? true,
          github: authOAuth?.github ?? true,
          microsoft: authOAuth?.microsoft ?? true,
        },
      },
    })
    mockGetPublicPortalConfig.mockResolvedValue({
      success: true,
      value: {
        oauth: {
          google: portalOAuth?.google ?? true,
          github: portalOAuth?.github ?? true,
        },
      },
    })
  } else {
    mockGetPublicAuthConfig.mockResolvedValue({
      success: false,
      error: { message: 'Organization not found' },
    })
    mockGetPublicPortalConfig.mockResolvedValue({
      success: false,
      error: { message: 'Organization not found' },
    })
  }
}

describe('OAuth Initiation Handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-key-for-hmac-signing')
    vi.stubEnv('NODE_ENV', 'development')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Helper function to create mock requests
  function createMockRequest(
    provider: string,
    params: {
      subdomain?: string
      context?: string
      popup?: string
    } = {}
  ): NextRequest {
    const url = new URL(`http://localhost:3000/api/auth/oauth/${provider}`)

    if (params.subdomain) {
      url.searchParams.set('subdomain', params.subdomain)
    }
    if (params.context) {
      url.searchParams.set('context', params.context)
    }
    if (params.popup) {
      url.searchParams.set('popup', params.popup)
    }

    return new NextRequest(url)
  }

  // Helper to parse redirect URL
  function parseRedirectUrl(response: NextResponse): URL | null {
    const location = response.headers.get('location')
    return location ? new URL(location) : null
  }

  // Helper to get cookie from response
  function getCookie(response: NextResponse, name: string): string | null {
    const setCookie = response.headers.get('set-cookie')
    if (!setCookie) return null

    const cookies = setCookie.split(';').map((c) => c.trim())
    for (const cookie of cookies) {
      if (cookie.startsWith(`${name}=`)) {
        return cookie.substring(name.length + 1)
      }
    }
    return null
  }

  // Helper to parse cookie attributes
  function parseCookieAttributes(response: NextResponse, _cookieName: string) {
    const setCookieHeader = response.headers.get('set-cookie')
    if (!setCookieHeader) return null

    const parts = setCookieHeader.split(';').map((p) => p.trim())
    const attributes: Record<string, string | boolean> = {}

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]
      if (part.includes('=')) {
        const [key, value] = part.split('=')
        attributes[key.toLowerCase()] = value
      } else {
        attributes[part.toLowerCase()] = true
      }
    }

    return attributes
  }

  describe('Valid OAuth Initiation', () => {
    it('creates signed state, sets cookie, and redirects to OAuth provider', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      // Should redirect
      expect(response.status).toBe(307)

      // Should redirect to OAuth URL
      const redirectUrl = parseRedirectUrl(response)
      expect(redirectUrl).toBeTruthy()
      expect(redirectUrl?.pathname).toBe('/api/auth/sign-in/social')
      expect(redirectUrl?.searchParams.get('provider')).toBe('google')
      expect(redirectUrl?.searchParams.get('callbackURL')).toBe(
        'http://localhost:3000/api/auth/oauth-callback'
      )

      // Should set oauth_target cookie with signed state
      const cookieValue = getCookie(response, 'oauth_target')
      expect(cookieValue).toBeTruthy()

      const parsedCookie = JSON.parse(decodeURIComponent(cookieValue!))
      expect(parsedCookie).toHaveProperty('payload')
      expect(parsedCookie).toHaveProperty('signature')

      const payload = JSON.parse(parsedCookie.payload)
      expect(payload.subdomain).toBe('acme')
      expect(payload.context).toBe('team')
      expect(payload.provider).toBe('google')
      expect(payload).toHaveProperty('nonce')
      expect(payload).toHaveProperty('timestamp')
    })

    it('includes popup mode in state when popup=true', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme', popup: 'true' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const cookieValue = getCookie(response, 'oauth_target')
      const parsedCookie = JSON.parse(decodeURIComponent(cookieValue!))
      const payload = JSON.parse(parsedCookie.payload)

      expect(payload.popup).toBe(true)
    })

    it('sets popup mode to false when popup is not true', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme', popup: 'false' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const cookieValue = getCookie(response, 'oauth_target')
      const parsedCookie = JSON.parse(decodeURIComponent(cookieValue!))
      const payload = JSON.parse(parsedCookie.payload)

      expect(payload.popup).toBe(false)
    })
  })

  describe('HMAC State Signing', () => {
    it('generates valid HMAC signature for state payload', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('github', { subdomain: 'testorg' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'github' }) })

      const cookieValue = getCookie(response, 'oauth_target')
      const parsedCookie = JSON.parse(decodeURIComponent(cookieValue!))

      // Verify signature
      const expectedSignature = createHmac('sha256', 'test-secret-key-for-hmac-signing')
        .update(parsedCookie.payload)
        .digest('hex')

      expect(parsedCookie.signature).toBe(expectedSignature)
    })

    it('includes all required fields in state payload', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', {
        subdomain: 'myorg',
        context: 'portal',
        popup: 'true',
      })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const cookieValue = getCookie(response, 'oauth_target')
      const parsedCookie = JSON.parse(decodeURIComponent(cookieValue!))
      const payload = JSON.parse(parsedCookie.payload)

      // Verify all required fields are present
      expect(payload).toMatchObject({
        subdomain: 'myorg',
        context: 'portal',
        provider: 'google',
        popup: true,
      })
      expect(payload).toHaveProperty('nonce')
      expect(payload).toHaveProperty('timestamp')
      expect(typeof payload.nonce).toBe('string')
      expect(typeof payload.timestamp).toBe('number')
    })
  })

  describe('Subdomain Validation', () => {
    it('rejects request with missing subdomain parameter', async () => {
      const request = createMockRequest('google', {})
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('subdomain parameter is required')
    })

    it('rejects subdomain with uppercase letters', async () => {
      const request = createMockRequest('google', { subdomain: 'MyOrg' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid subdomain format')
    })

    it('rejects subdomain with special characters', async () => {
      const request = createMockRequest('google', { subdomain: 'my_org!' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid subdomain format')
    })

    it('rejects subdomain with spaces', async () => {
      const request = createMockRequest('google', { subdomain: 'my org' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid subdomain format')
    })

    it('accepts valid subdomain with lowercase letters', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'myorg' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(307)
    })

    it('accepts valid subdomain with numbers', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'org123' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(307)
    })

    it('accepts valid subdomain with hyphens', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'my-org-123' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(307)
    })
  })

  describe('Context Validation', () => {
    it('defaults to team context when context param is not provided', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const cookieValue = getCookie(response, 'oauth_target')
      const parsedCookie = JSON.parse(decodeURIComponent(cookieValue!))
      const payload = JSON.parse(parsedCookie.payload)

      expect(payload.context).toBe('team')
    })

    it('accepts portal context when explicitly provided', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme', context: 'portal' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const cookieValue = getCookie(response, 'oauth_target')
      const parsedCookie = JSON.parse(decodeURIComponent(cookieValue!))
      const payload = JSON.parse(parsedCookie.payload)

      expect(payload.context).toBe('portal')
    })

    it('rejects invalid context value', async () => {
      const request = createMockRequest('google', { subdomain: 'acme', context: 'invalid' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid context')
    })
  })

  describe('Provider Enablement Check - Team Context', () => {
    it('allows Google OAuth when enabled for team context', async () => {
      mockOrgConfigs({
        authOAuth: { google: true, github: false, microsoft: false },
        portalOAuth: { google: false, github: false },
      })

      const request = createMockRequest('google', { subdomain: 'acme', context: 'team' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(307)
    })

    it('rejects Google OAuth when disabled for team context', async () => {
      mockOrgConfigs({
        authOAuth: { google: false, github: true, microsoft: true },
        portalOAuth: { google: true, github: true },
      })

      const request = createMockRequest('google', { subdomain: 'acme', context: 'team' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error).toBe('This authentication method is not enabled for this organization')
    })

    it('allows GitHub OAuth when enabled for team context', async () => {
      mockOrgConfigs({
        authOAuth: { google: false, github: true, microsoft: false },
        portalOAuth: { google: false, github: false },
      })

      const request = createMockRequest('github', { subdomain: 'acme', context: 'team' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'github' }) })

      expect(response.status).toBe(307)
    })

    it('rejects GitHub OAuth when disabled for team context', async () => {
      mockOrgConfigs({
        authOAuth: { google: true, github: false, microsoft: true },
        portalOAuth: { google: true, github: true },
      })

      const request = createMockRequest('github', { subdomain: 'acme', context: 'team' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'github' }) })

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error).toBe('This authentication method is not enabled for this organization')
    })

    it('allows Microsoft OAuth when enabled for team context', async () => {
      mockOrgConfigs({
        authOAuth: { google: false, github: false, microsoft: true },
        portalOAuth: { google: false, github: false },
      })

      const request = createMockRequest('microsoft', { subdomain: 'acme', context: 'team' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'microsoft' }) })

      expect(response.status).toBe(307)
    })

    it('rejects Microsoft OAuth when disabled for team context', async () => {
      mockOrgConfigs({
        authOAuth: { google: true, github: true, microsoft: false },
        portalOAuth: { google: true, github: true },
      })

      const request = createMockRequest('microsoft', { subdomain: 'acme', context: 'team' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'microsoft' }) })

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error).toBe('This authentication method is not enabled for this organization')
    })
  })

  describe('Provider Enablement Check - Portal Context', () => {
    it('allows Google OAuth when enabled for portal context', async () => {
      mockOrgConfigs({
        authOAuth: { google: false, github: false, microsoft: false },
        portalOAuth: { google: true, github: false },
      })

      const request = createMockRequest('google', { subdomain: 'acme', context: 'portal' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(307)
    })

    it('rejects Google OAuth when disabled for portal context', async () => {
      mockOrgConfigs({
        authOAuth: { google: true, github: true, microsoft: true },
        portalOAuth: { google: false, github: true },
      })

      const request = createMockRequest('google', { subdomain: 'acme', context: 'portal' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error).toBe('This authentication method is not enabled for this organization')
    })

    it('allows GitHub OAuth when enabled for portal context', async () => {
      mockOrgConfigs({
        authOAuth: { google: false, github: false, microsoft: false },
        portalOAuth: { google: false, github: true },
      })

      const request = createMockRequest('github', { subdomain: 'acme', context: 'portal' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'github' }) })

      expect(response.status).toBe(307)
    })

    it('rejects GitHub OAuth when disabled for portal context', async () => {
      mockOrgConfigs({
        authOAuth: { google: true, github: true, microsoft: true },
        portalOAuth: { google: true, github: false },
      })

      const request = createMockRequest('github', { subdomain: 'acme', context: 'portal' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'github' }) })

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error).toBe('This authentication method is not enabled for this organization')
    })

    it('rejects Microsoft OAuth for portal context (not supported)', async () => {
      mockOrgConfigs({
        authOAuth: { google: true, github: true, microsoft: true },
        portalOAuth: { google: true, github: true },
      })

      const request = createMockRequest('microsoft', { subdomain: 'acme', context: 'portal' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'microsoft' }) })

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error).toBe('This authentication method is not enabled for this organization')
    })
  })

  describe('Organization Validation', () => {
    it('returns 404 when organization does not exist', async () => {
      mockOrgConfigs({ found: false })

      const request = createMockRequest('google', { subdomain: 'nonexistent' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Organization not found')
    })
  })

  describe('Provider Configuration', () => {
    it('returns 500 when BETTER_AUTH_SECRET is not configured', async () => {
      vi.stubEnv('BETTER_AUTH_SECRET', undefined)

      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toBe('Server configuration error')
    })

    it('rejects invalid provider name', async () => {
      const request = createMockRequest('facebook', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'facebook' }) })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid OAuth provider')
    })
  })

  describe('Cookie Attributes', () => {
    it('sets httpOnly cookie attribute', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const attributes = parseCookieAttributes(response, 'oauth_target')
      expect(attributes).toBeTruthy()
      expect(attributes?.httponly).toBe(true)
    })

    it('sets secure cookie attribute in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const attributes = parseCookieAttributes(response, 'oauth_target')
      expect(attributes?.secure).toBe(true)
    })

    it('does not set secure cookie attribute in development', async () => {
      vi.stubEnv('NODE_ENV', 'development')

      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const setCookieHeader = response.headers.get('set-cookie')
      expect(setCookieHeader).not.toContain('Secure')
    })

    it('sets sameSite=lax attribute', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const attributes = parseCookieAttributes(response, 'oauth_target')
      expect(attributes?.samesite).toBe('lax')
    })

    it('sets path=/ attribute', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const attributes = parseCookieAttributes(response, 'oauth_target')
      expect(attributes?.path).toBe('/')
    })

    it('sets maxAge=300 (5 minutes) attribute', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const attributes = parseCookieAttributes(response, 'oauth_target')
      expect(attributes?.['max-age']).toBe('300')
    })
  })

  describe('Nonce Generation for Replay Prevention', () => {
    it('generates unique nonce for each request', async () => {
      mockOrgConfigs({})

      const request1 = createMockRequest('google', { subdomain: 'acme' })
      const response1 = await GET(request1, { params: Promise.resolve({ provider: 'google' }) })

      const request2 = createMockRequest('google', { subdomain: 'acme' })
      const response2 = await GET(request2, { params: Promise.resolve({ provider: 'google' }) })

      const cookie1 = getCookie(response1, 'oauth_target')
      const cookie2 = getCookie(response2, 'oauth_target')

      const parsed1 = JSON.parse(decodeURIComponent(cookie1!))
      const parsed2 = JSON.parse(decodeURIComponent(cookie2!))

      const payload1 = JSON.parse(parsed1.payload)
      const payload2 = JSON.parse(parsed2.payload)

      expect(payload1.nonce).not.toBe(payload2.nonce)
    })

    it('generates nonce with 32 hex characters', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const cookie = getCookie(response, 'oauth_target')
      const parsed = JSON.parse(decodeURIComponent(cookie!))
      const payload = JSON.parse(parsed.payload)

      expect(payload.nonce).toMatch(/^[0-9a-f]{32}$/)
    })
  })

  describe('Timestamp Inclusion for Expiry Validation', () => {
    it('includes current timestamp in state payload', async () => {
      mockOrgConfigs({})

      const before = Date.now()
      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })
      const after = Date.now()

      const cookie = getCookie(response, 'oauth_target')
      const parsed = JSON.parse(decodeURIComponent(cookie!))
      const payload = JSON.parse(parsed.payload)

      expect(payload.timestamp).toBeGreaterThanOrEqual(before)
      expect(payload.timestamp).toBeLessThanOrEqual(after)
    })

    it('timestamp is a number', async () => {
      mockOrgConfigs({})

      const request = createMockRequest('google', { subdomain: 'acme' })
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) })

      const cookie = getCookie(response, 'oauth_target')
      const parsed = JSON.parse(decodeURIComponent(cookie!))
      const payload = JSON.parse(parsed.payload)

      expect(typeof payload.timestamp).toBe('number')
      expect(Number.isInteger(payload.timestamp)).toBe(true)
    })
  })
})
