import { afterEach, describe, expect, it, vi } from 'vitest'

const checkUrlSafety = vi.fn()

vi.mock('@/lib/server/config', () => ({ config: {} }))
vi.mock('@/lib/server/db', () => ({
  assistantConnectors: {},
  db: {},
  eq: () => ({}),
}))
vi.mock('@/lib/server/encryption', () => ({
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
}))
vi.mock('@/lib/server/content/ssrf-guard', () => ({
  checkUrlSafety: (...args: unknown[]) => checkUrlSafety(...args),
}))
vi.mock('../connectors.mcp-client', () => ({
  listRemoteConnectorTools: vi.fn(),
  callRemoteConnectorTool: vi.fn(),
}))

import { assertConnectorUrlSafe } from '../connectors.service'
import { ValidationError } from '@/lib/shared/errors'

describe('assertConnectorUrlSafe', () => {
  const previousEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = previousEnv
    checkUrlSafety.mockReset()
  })

  it('rejects http URLs outside local development', async () => {
    process.env.NODE_ENV = 'production'
    await expect(assertConnectorUrlSafe('http://mcp.example.com/mcp')).rejects.toBeInstanceOf(
      ValidationError
    )
    expect(checkUrlSafety).not.toHaveBeenCalled()
  })

  it('rejects private resolved addresses', async () => {
    process.env.NODE_ENV = 'production'
    checkUrlSafety.mockResolvedValue({ safe: false, reason: 'ssrf-rejected' })
    await expect(assertConnectorUrlSafe('https://internal.example.com/mcp')).rejects.toMatchObject({
      code: 'CONNECTOR_URL_BLOCKED',
    })
  })

  it('allows https when the SSRF guard accepts the host', async () => {
    process.env.NODE_ENV = 'production'
    checkUrlSafety.mockResolvedValue({ safe: true, address: '1.1.1.1', family: 4 })
    await expect(assertConnectorUrlSafe('https://mcp.example.com/mcp')).resolves.toBeUndefined()
  })
})
