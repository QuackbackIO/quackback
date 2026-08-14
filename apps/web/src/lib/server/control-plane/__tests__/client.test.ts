import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock('@/lib/server/workspaces/workspace-context', () => ({
  getCurrentWorkspace: () => ({ id: 'workspace-1' }),
  getWorkspaceSecretKey: () => 'workspace-a-secret-key-000000000000000000',
}))

import {
  deriveControlPlaneCredential,
  fetchBillingCatalogue,
  reportTrialActivation,
  requestWorkspaceIdentityMutation,
} from '../client'

beforeEach(() => {
  process.env.QUACKBACK_CONTROL_PLANE_URL = 'https://control.example.com'
  hoisted.fetch.mockReset()
  vi.stubGlobal('fetch', hoisted.fetch)
})

describe('workspace control-plane credential', () => {
  it('matches the stable per-workspace derivation contract', () => {
    const a = deriveControlPlaneCredential('workspace-a-secret-key-000000000000000000')
    const b = deriveControlPlaneCredential('workspace-b-secret-key-000000000000000000')
    expect(a).toMatch(/^qbint_[A-Za-z0-9_-]{43}$/)
    expect(deriveControlPlaneCredential('workspace-a-secret-key-000000000000000000')).toBe(a)
    expect(a).not.toBe(b)
  })

  it('refuses weak source material', () => {
    expect(() => deriveControlPlaneCredential('short')).toThrow('too short')
  })

  it.each(['started', 'already_started'] as const)(
    'accepts the control plane trial status %s',
    async (status) => {
      hoisted.fetch.mockResolvedValue(new Response(JSON.stringify({ status }), { status: 200 }))

      await expect(
        reportTrialActivation({
          idempotencyKey: 'starter:one',
          resolution: 'created',
          artifactType: 'board',
          occurredAt: '2026-08-14T12:00:00.000Z',
        })
      ).resolves.toBe(status)
    }
  )

  it('sends only customer identity fields and no caller-supplied workspace authority', async () => {
    hoisted.fetch.mockResolvedValue(
      new Response(JSON.stringify({ projectionToken: 'signed-projection' }), { status: 200 })
    )
    await expect(
      requestWorkspaceIdentityMutation({ displayName: 'Acme', platformLabel: 'acme' })
    ).resolves.toEqual({ projectionToken: 'signed-projection' })
    const [, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ displayName: 'Acme', platformLabel: 'acme' })
    expect(String(init.body)).not.toContain('workspaceId')
    expect(String(init.body)).not.toContain('instanceId')
  })

  it('loads the billing catalogue over GET without a workspace id', async () => {
    hoisted.fetch.mockResolvedValue(
      new Response(JSON.stringify({ version: 1, plans: [], currency: 'usd' }), { status: 200 })
    )
    await fetchBillingCatalogue()
    const [url, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('/api/v1/internal/billing/catalogue')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })
})
