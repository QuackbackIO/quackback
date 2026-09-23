// @vitest-environment node
/**
 * Browser-hosted MCP clients (for example a web inspector) run discovery,
 * registration, token exchange and MCP calls with `fetch` from their own
 * origin. Those surfaces are bearer or PKCE based, never cookie based, so they
 * get `*` CORS with no credentials. Everything else keeps no CORS at all.
 */
import { describe, it, expect } from 'vitest'
import { handleOAuthCors, isOAuthCorsPath } from '../oauth-cors'

const ORIGIN = 'http://localhost:6274'

function req(path: string, method = 'GET') {
  return new Request(`https://feedback.example.com${path}`, {
    method,
    headers: { origin: ORIGIN },
  })
}

describe('isOAuthCorsPath', () => {
  it.each([
    '/api/mcp',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/api/mcp',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/api/auth',
    '/.well-known/openid-configuration',
    '/.well-known/openid-configuration/api/auth',
    '/api/auth/.well-known/openid-configuration',
    '/api/auth/oauth2/register',
    '/api/auth/oauth2/token',
    '/api/auth/oauth2/revoke',
    '/api/auth/jwks',
  ])('covers %s', (path) => {
    expect(isOAuthCorsPath(path)).toBe(true)
  })

  it.each([
    '/api/auth/sign-in/email',
    '/api/auth/get-session',
    '/api/auth/oauth2/authorize',
    '/api/auth/oauth2/consent',
    '/api/auth/oauth2/introspect',
    '/api/mcp/extra',
    '/admin',
  ])('leaves %s alone', (path) => {
    expect(isOAuthCorsPath(path)).toBe(false)
  })
})

describe('handleOAuthCors', () => {
  it('answers a preflight without running the rest of the chain', async () => {
    let ran = false
    const out = await handleOAuthCors({
      request: new Request('https://feedback.example.com/api/mcp', {
        method: 'OPTIONS',
        headers: {
          origin: ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization, content-type, mcp-session-id',
        },
      }),
      next: async () => {
        ran = true
        return { response: new Response('nope') }
      },
    })
    expect(ran).toBe(false)
    const res = out as Response
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    const allowed = res.headers.get('access-control-allow-headers')?.toLowerCase() ?? ''
    for (const h of [
      'authorization',
      'content-type',
      'mcp-session-id',
      'mcp-protocol-version',
      'dpop',
    ]) {
      expect(allowed).toContain(h)
    }
  })

  it('adds CORS and exposes the MCP and auth challenge headers on responses', async () => {
    const out = (await handleOAuthCors({
      request: req('/api/mcp', 'POST'),
      next: async () => ({
        response: new Response(null, {
          status: 401,
          headers: { 'www-authenticate': 'Bearer resource_metadata="x"' },
        }),
      }),
    })) as { response: Response }
    expect(out.response.headers.get('access-control-allow-origin')).toBe('*')
    const exposed = out.response.headers.get('access-control-expose-headers')?.toLowerCase() ?? ''
    expect(exposed).toContain('www-authenticate')
    expect(exposed).toContain('mcp-session-id')
    expect(exposed).toContain('dpop-nonce')
  })

  it('rebuilds a response whose headers are immutable', async () => {
    const upstream = Response.redirect('https://feedback.example.com/x', 302)
    expect(() => upstream.headers.set('x', '1')).toThrow()
    const out = (await handleOAuthCors({
      request: req('/api/auth/oauth2/token', 'POST'),
      next: async () => ({ response: upstream }),
    })) as { response: Response }
    expect(out.response.status).toBe(302)
    expect(out.response.headers.get('location')).toBe('https://feedback.example.com/x')
    expect(out.response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('does not touch other paths, including preflights to them', async () => {
    const plain = new Response('ok')
    const out = (await handleOAuthCors({
      request: req('/api/auth/sign-in/email', 'POST'),
      next: async () => ({ response: plain }),
    })) as { response: Response }
    expect(out.response.headers.get('access-control-allow-origin')).toBeNull()

    let ran = false
    await handleOAuthCors({
      request: req('/api/auth/sign-in/email', 'OPTIONS'),
      next: async () => {
        ran = true
        return { response: new Response(null, { status: 404 }) }
      },
    })
    expect(ran).toBe(true)
  })
})
