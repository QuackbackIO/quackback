import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ pooled: true, read: vi.fn(), routing: vi.fn(), update: vi.fn() }))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator() {
      return this
    },
    handler(fn: unknown) {
      return fn
    },
  }),
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: async () => ({}) }))
vi.mock('@/lib/server/audit/log', () => ({ actorFromAuth: () => ({ type: 'system' }) }))
vi.mock('@/lib/server/config', () => ({
  config: {
    get isPooledTenancy() {
      return m.pooled
    },
  },
}))
vi.mock('@/lib/server/db', () => ({
  db: { query: { integrations: { findFirst: m.read } } },
  integrations: { integrationType: 'type' },
  eq: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.assistant', () => ({
  getAssistantSettings: vi.fn(),
  updateAssistantConfig: m.update,
}))
vi.mock('@/lib/server/integrations/install-registry', () => ({ getInstallRouting: m.routing }))
import { SLACK_REQUIRED_SCOPES } from '../../../scopes'
import { setSlackAssistantEnabledFn } from '../settings'
const enable = (enabled = true) =>
  (setSlackAssistantEnabledFn as any)({ data: { expectedRevision: 1, enabled } })
beforeEach(() => {
  vi.resetAllMocks()
  m.pooled = true
  m.read.mockResolvedValue({
    status: 'active',
    config: { workspaceId: 'T1', scopes: SLACK_REQUIRED_SCOPES.join(',') },
  })
  m.routing.mockResolvedValue([{ externalId: 'T1', revokedAt: null }])
})
it('requires a current matching route before enabling Cloud Slack', async () => {
  for (const routes of [
    [],
    [{ externalId: 'T2', revokedAt: null }],
    [{ externalId: 'T1', revokedAt: 'now' }],
  ]) {
    m.routing.mockResolvedValue(routes)
    await expect(enable()).rejects.toThrow('Register Slack routing')
  }
  expect(m.update).not.toHaveBeenCalled()
})
it('fails closed while CP is unavailable', async () => {
  m.routing.mockRejectedValue(new Error('unavailable'))
  await expect(enable()).rejects.toThrow('unavailable')
  expect(m.update).not.toHaveBeenCalled()
})
it('enables a registered route and allows disabling without CP', async () => {
  await enable()
  expect(m.update).toHaveBeenCalledOnce()
  m.routing.mockClear()
  await enable(false)
  expect(m.routing).not.toHaveBeenCalled()
})
it('does not require CP routing when self hosted', async () => {
  m.pooled = false
  await enable()
  expect(m.routing).not.toHaveBeenCalled()
  expect(m.update).toHaveBeenCalledOnce()
})
