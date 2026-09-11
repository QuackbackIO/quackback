import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://feedback.example.com' },
}))

import { MCP_FIRST_CONNECT_SCOPES } from '@/lib/shared/api-key-scopes'
import { mcpProtectedResourceMetadata } from '../protected-resource-metadata'
import { insufficientScopeChallenge, unauthenticatedMcpChallenge } from '../oauth-challenge'

describe('MCP protected resource metadata', () => {
  it('advertises only the three first-connect read scopes', () => {
    const doc = mcpProtectedResourceMetadata('https://feedback.example.com')
    expect(doc.resource).toBe('https://feedback.example.com/api/mcp')
    expect(doc.scopes_supported).toEqual([...MCP_FIRST_CONNECT_SCOPES])
    expect(doc.scopes_supported).toEqual(['read:feedback', 'read:article', 'read:chat'])
    expect(doc.scopes_supported).not.toContain('offline_access')
    expect(doc.scopes_supported).not.toContain('write:feedback')
    expect(doc.scopes_supported).not.toContain('openid')
  })
})

describe('MCP OAuth challenges', () => {
  it('puts first-connect scopes on the unauthenticated 401 challenge', () => {
    const header = unauthenticatedMcpChallenge()
    expect(header).toContain('scope="read:feedback read:article read:chat"')
    expect(header).toContain('resource_metadata="')
    expect(header).toContain('/.well-known/oauth-protected-resource')
    expect(header).not.toContain('/api/mcp')
  })

  it('returns HTTP 403 insufficient_scope for the current operation', async () => {
    const response = insufficientScopeChallenge('write:feedback')
    expect(response.status).toBe(403)
    const header = response.headers.get('www-authenticate') ?? ''
    expect(header).toContain('error="insufficient_scope"')
    expect(header).toContain('scope="write:feedback"')
    expect(header).toContain('resource_metadata=')
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('insufficient_scope')
  })
})
