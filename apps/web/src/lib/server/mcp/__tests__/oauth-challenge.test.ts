import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://feedback.example.com' },
}))

import { MCP_FIRST_CONNECT_SCOPES } from '@/lib/shared/api-key-scopes'
import { mcpProtectedResourceMetadata } from '../protected-resource-metadata'
import { insufficientScopeChallenge, unauthenticatedMcpChallenge } from '../oauth-challenge'

describe('MCP protected resource metadata', () => {
  it('advertises the four first-connect read scopes', () => {
    const doc = mcpProtectedResourceMetadata('https://feedback.example.com')
    expect(doc.resource).toBe('https://feedback.example.com/api/mcp')
    expect(doc.authorization_servers).toEqual(['https://feedback.example.com/api/auth'])
    expect(doc.scopes_supported).toEqual([...MCP_FIRST_CONNECT_SCOPES])
    expect(doc.scopes_supported).toEqual([
      'read:feedback',
      'read:article',
      'read:chat',
      'read:settings',
    ])
    expect(doc.scopes_supported).not.toContain('offline_access')
    expect(doc.scopes_supported).not.toContain('write:feedback')
    expect(doc.scopes_supported).not.toContain('write:settings')
    expect(doc.scopes_supported).not.toContain('openid')
  })
})

describe('MCP OAuth challenges', () => {
  it('asks for every capability on the unauthenticated 401 challenge', () => {
    const header = unauthenticatedMcpChallenge()
    expect(header).toContain(
      'scope="read:feedback write:feedback write:changelog read:article write:article read:chat write:chat read:settings write:settings"'
    )
    expect(header).not.toContain('offline_access')
    expect(header).not.toContain('openid')
    expect(header).toContain('resource_metadata="')
    expect(header).toContain('/.well-known/oauth-protected-resource')
    expect(header).not.toContain('/api/mcp')
  })

  describe('insufficient scope', () => {
    const scopeOf = (response: Response) =>
      /scope="([^"]*)"/.exec(response.headers.get('www-authenticate') ?? '')?.[1]

    it('returns HTTP 403 with every scope the retried call needs', () => {
      const response = insufficientScopeChallenge({
        missing: ['write:feedback'],
        held: ['read:feedback', 'read:article', 'read:chat'],
      })
      expect(response.status).toBe(403)
      const header = response.headers.get('www-authenticate') ?? ''
      expect(header).toContain('error="insufficient_scope"')
      expect(header).toContain('resource_metadata=')
      // What the token holds, plus the missing write, in catalogue order.
      expect(scopeOf(response)).toBe('read:feedback write:feedback read:article read:chat')
    })

    it('adds the read a missing write implies', () => {
      const response = insufficientScopeChallenge({ missing: ['write:article'], held: [] })
      expect(scopeOf(response)).toBe('read:article write:article')
    })

    it('puts every missing scope in the one challenge', () => {
      const response = insufficientScopeChallenge({
        missing: ['write:chat', 'write:feedback'],
        held: ['read:feedback'],
      })
      expect(scopeOf(response)).toBe('read:feedback write:feedback read:chat write:chat')
    })

    it('tells the person what the connection cannot do and how to fix it', async () => {
      const response = insufficientScopeChallenge({
        missing: ['write:feedback'],
        held: ['read:feedback'],
        requestId: 7,
      })
      const header = response.headers.get('www-authenticate') ?? ''
      const body = (await response.json()) as {
        id: number
        result: { isError: boolean; content: { text: string }[]; _meta: Record<string, string[]> }
      }
      expect(body.id).toBe(7)
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toBe(
        'This connection is not allowed to make changes to Feedback (missing scope: write:feedback). Reconnect and choose Full access to allow it.'
      )
      expect(header).toContain(`error_description="${body.result.content[0].text}"`)
      // The same challenge rides the body for clients that read it there.
      expect(body.result._meta['mcp/www_authenticate']).toEqual([header])
    })

    it('keeps offline_access for a token that can refresh', () => {
      const response = insufficientScopeChallenge({
        missing: ['write:feedback'],
        held: ['read:feedback'],
        offlineAccess: true,
      })
      expect(scopeOf(response)).toBe('offline_access read:feedback write:feedback')
    })

    it('answers every call in a batch, as an array', async () => {
      const response = insufficientScopeChallenge({
        missing: ['write:feedback'],
        held: ['read:feedback'],
        calls: [
          { id: 1, method: 'tools/call' },
          { id: 2, method: 'tools/call' },
        ],
        batch: true,
      })
      const body = (await response.json()) as { id: number; result: { isError: boolean } }[]
      expect(Array.isArray(body)).toBe(true)
      expect(body.map((answer) => answer.id)).toEqual([1, 2])
      expect(body.every((answer) => answer.result.isError)).toBe(true)
    })

    it('refuses a resource read as a JSON-RPC error, not a tool result', async () => {
      const response = insufficientScopeChallenge({
        missing: ['read:settings'],
        held: [],
        calls: [{ id: 'r1', method: 'resources/read' }],
      })
      const header = response.headers.get('www-authenticate') ?? ''
      const body = (await response.json()) as {
        id: string
        result?: unknown
        error: { code: number; message: string; data: Record<string, string[]> }
      }
      expect(body.id).toBe('r1')
      expect(body.result).toBeUndefined()
      expect(body.error.message).toContain('missing scope: read:settings')
      expect(body.error.data['mcp/www_authenticate']).toEqual([header])
    })
  })
})
