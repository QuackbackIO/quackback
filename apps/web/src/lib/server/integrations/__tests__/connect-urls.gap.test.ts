/**
 * Differential-coverage tests for the per-provider OAuth connect-URL server
 * functions. Every provider's getXConnectUrl handler shares the same shape
 * (requireAuth → platform-credential check → getOAuthReturnDomain → sign state),
 * so one mock setup drives them all via the createServerFn-capture pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args?: { data?: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []

const m = vi.hoisted(() => ({ hasCreds: vi.fn(), requireAuth: vi.fn() }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {
      validator: () => chain,
      inputValidator: () => chain,
      handler: (fn: AnyHandler) => {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: m.requireAuth }))
vi.mock('@/lib/server/auth/oauth-state', () => ({ signOAuthState: () => 'SIGNED_STATE' }))
vi.mock('@/lib/server/integrations/oauth', () => ({ getOAuthReturnDomain: () => 'example.com' }))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: m.hasCreds,
  getPlatformCredentials: vi.fn(),
}))

const PROVIDERS: Array<{ name: string; path: string; slug: string }> = [
  { name: 'GitLab', path: '../gitlab/functions', slug: 'gitlab' },
  { name: 'Intercom', path: '../intercom/functions', slug: 'intercom' },
  { name: 'ClickUp', path: '../clickup/functions', slug: 'clickup' },
  { name: 'HubSpot', path: '../hubspot/functions', slug: 'hubspot' },
  { name: 'Asana', path: '../asana/functions', slug: 'asana' },
  { name: 'Linear', path: '../linear/functions', slug: 'linear' },
  { name: 'Teams', path: '../teams/functions', slug: 'teams' },
  { name: 'Jira', path: '../jira/functions', slug: 'jira' },
]

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAuth.mockResolvedValue({ settings: { id: 'org_1' }, principal: { id: 'pr_1' } })
  m.hasCreds.mockResolvedValue(true)
})

describe('OAuth connect-URL server functions', () => {
  for (const p of PROVIDERS) {
    it(`${p.name}: builds a signed connect URL on the happy path`, async () => {
      handlers.length = 0
      vi.resetModules()
      await import(p.path)
      const connect = handlers[0]
      const url = (await connect()) as string
      expect(url).toContain(`/oauth/${p.slug}/connect`)
      expect(url).toContain('SIGNED_STATE')
    })

    it(`${p.name}: throws when platform credentials are missing`, async () => {
      handlers.length = 0
      vi.resetModules()
      m.hasCreds.mockResolvedValueOnce(false)
      await import(p.path)
      const connect = handlers[0]
      await expect(connect()).rejects.toThrow(/credentials not configured/i)
    })
  }
})
