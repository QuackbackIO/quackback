import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ pooled: false, put: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/server/config', () => ({
  config: {
    get isPooledTenancy() {
      return mocks.pooled
    },
  },
}))
vi.mock('@/lib/server/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('@/lib/server/integrations', () => ({
  getIntegration: (type: string) =>
    type === 'slack'
      ? {
          install: {
            externalId: (c: any) => c.workspaceId,
            metadata: (c: any) => ({ bot_user_id: c.botUserId }),
          },
        }
      : undefined,
}))
vi.mock('@/lib/server/control-plane/client', () => ({
  putWorkspaceControlPlane: mocks.put,
  deleteWorkspaceControlPlane: mocks.remove,
  getWorkspaceControlPlane: vi.fn(),
  ControlPlaneUnavailableError: class extends Error {
    constructor(
      message: string,
      public status: number
    ) {
      super(message)
    }
  },
}))
import { registerInstall, unregisterInstall, InstallBoundElsewhereError } from '../install-registry'
import { ControlPlaneUnavailableError } from '@/lib/server/control-plane/client'
import { missingSlackScopes, SLACK_REQUIRED_SCOPES } from '@/integrations/slack/scopes'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.pooled = false
})
describe('install registry', () => {
  it('does not contact Cloud in single tenancy or for providers without install identity', async () => {
    await registerInstall('slack', { workspaceId: 'T1' })
    expect(mocks.put).not.toHaveBeenCalled()
    mocks.pooled = true
    await registerInstall('github', {})
    expect(mocks.put).not.toHaveBeenCalled()
  })
  it('registers external identity and metadata', async () => {
    mocks.pooled = true
    await registerInstall('slack', { workspaceId: 'T1', botUserId: 'B1' })
    expect(mocks.put).toHaveBeenCalledWith('/api/v1/internal/integration-installs', {
      provider: 'slack',
      externalId: 'T1',
      metadata: { bot_user_id: 'B1' },
    })
  })
  it('turns 409 into the rollback signal and preserves other failures', async () => {
    mocks.pooled = true
    mocks.put.mockRejectedValueOnce(
      new ControlPlaneUnavailableError('external_id_bound_elsewhere', 409)
    )
    await expect(registerInstall('slack', { workspaceId: 'T1' })).rejects.toBeInstanceOf(
      InstallBoundElsewhereError
    )
    mocks.put.mockRejectedValueOnce(new Error('unavailable'))
    await expect(registerInstall('slack', { workspaceId: 'T1' })).rejects.toThrow('unavailable')
  })
  it('tolerates disconnect routing outages', async () => {
    mocks.pooled = true
    mocks.remove.mockRejectedValueOnce(new Error('unavailable'))
    await expect(unregisterInstall('slack', { workspaceId: 'T1' })).resolves.toBeUndefined()
  })
  it('reports missing scopes with exact membership', () => {
    expect(missingSlackScopes(SLACK_REQUIRED_SCOPES.join(','))).toEqual([])
    expect(missingSlackScopes('chat:write')).toContain('users:read.email')
    expect(missingSlackScopes('chat:write')).not.toContain('chat:write')
  })
})
