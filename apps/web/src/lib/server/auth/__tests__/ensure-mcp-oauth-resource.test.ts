import { describe, expect, it, vi } from 'vitest'
import { ensureMcpOauthResource, mcpOauthResourceSeedRow } from '../ensure-mcp-oauth-resource'

const IDENTIFIER = 'https://acme.example.com/api/mcp'
const SCOPES = ['read:feedback', 'write:feedback'] as const

describe('mcpOauthResourceSeedRow', () => {
  it('matches the Better Auth insertOnly seed payload for the MCP resource', () => {
    const row = mcpOauthResourceSeedRow(IDENTIFIER, SCOPES)
    expect(row.identifier).toBe(IDENTIFIER)
    expect(row.name).toBe(IDENTIFIER)
    expect(row.allowedScopes).toEqual([...SCOPES])
    expect(row.dpopBoundAccessTokensRequired).toBe(false)
    expect(row.disabled).toBe(false)
    expect(row.policyVersion).toBe(1)
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })
})

describe('ensureMcpOauthResource', () => {
  it('inserts with ON CONFLICT DO NOTHING on identifier', async () => {
    const onConflictDoNothing = vi.fn(async () => undefined)
    const values = vi.fn(() => ({ onConflictDoNothing }))
    const insert = vi.fn(() => ({ values }))
    const table = { identifier: { name: 'identifier' } }

    await ensureMcpOauthResource({
      db: { insert } as never,
      table: table as never,
      identifier: IDENTIFIER,
      allowedScopes: SCOPES,
    })

    expect(insert).toHaveBeenCalledWith(table)
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: IDENTIFIER,
        allowedScopes: [...SCOPES],
      })
    )
    expect(onConflictDoNothing).toHaveBeenCalledWith({ target: table.identifier })
  })
})
