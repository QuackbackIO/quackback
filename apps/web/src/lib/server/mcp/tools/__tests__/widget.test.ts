import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const mockStatus = vi.fn()
vi.mock('@/lib/server/domains/settings/widget-install-pairing', () => ({
  getWidgetInstallStatus: (...a: unknown[]) => mockStatus(...a),
}))

import { registerWidgetTools } from '../widget'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function collect(auth: McpAuthContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerWidgetTools(fakeServer as never, auth)
  return handlers
}

const teamAuth = {
  principalId: 'principal_key',
  userId: 'user_1',
  name: 'Agent',
  email: 'agent@acme.com',
  role: 'admin' as const,
  authMethod: 'api-key' as const,
  scopes: ['read:feedback'],
} as unknown as McpAuthContext

const parse = (r: CallToolResult) => JSON.parse((r.content[0] as { text: string }).text)

beforeEach(() => {
  vi.clearAllMocks()
  mockStatus.mockResolvedValue({
    connected: true,
    enabled: true,
    lastDetectedAt: '2026-09-11T10:00:00.000Z',
    originHost: 'app.example.com',
    sdkVersion: '0.1.6',
    currentSdkVersion: '0.1.6',
    sdkNeedsUpdate: false,
  })
})

describe('widget MCP tools', () => {
  it('registers widget_install_status', () => {
    expect([...collect(teamAuth).keys()]).toEqual(['widget_install_status'])
  })

  it('returns connection evidence and never a signing secret', async () => {
    const out = await collect(teamAuth).get('widget_install_status')!({})
    const body = parse(out)
    expect(body.connected).toBe(true)
    expect(body.enabled).toBe(true)
    expect(body.originHost).toBe('app.example.com')
    expect(JSON.stringify(body)).not.toContain('wgt_')
    expect(JSON.stringify(body)).not.toMatch(/secret/i)
  })

  it('is team-only', async () => {
    const portal = { ...teamAuth, role: 'user' } as unknown as McpAuthContext
    const out = await collect(portal).get('widget_install_status')!({})
    expect(out.isError).toBe(true)
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it('requires read:feedback', async () => {
    const noScope = { ...teamAuth, scopes: [] } as unknown as McpAuthContext
    const out = await collect(noScope).get('widget_install_status')!({})
    expect(out.isError).toBe(true)
    expect(mockStatus).not.toHaveBeenCalled()
  })
})
