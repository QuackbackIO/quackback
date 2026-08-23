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
  fetchOwnerWorkspaces,
  fetchSeatsPreview,
  leaveCloudWorkspace,
  pushWorkspaceMembership,
  wipeCloudWorkspace,
  openOwnerWorkspace,
  transferWorkspaceOwnership,
  reportTrialActivation,
  reportWorkspaceUsage,
  requestWorkspaceIdentityMutation,
  createHostedBillingSession,
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

  it('sends a custom-domain action without a workspace authority field', async () => {
    hoisted.fetch.mockResolvedValue(
      new Response(JSON.stringify({ projectionToken: 'signed-projection' }), { status: 200 })
    )
    await requestWorkspaceIdentityMutation({
      customDomain: { action: 'add', hostname: 'feedback.acme.test' },
    })
    const [, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      customDomain: { action: 'add', hostname: 'feedback.acme.test' },
    })
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

  it('lists owner workspaces over GET without a workspace id', async () => {
    hoisted.fetch.mockResolvedValue(
      new Response(JSON.stringify({ workspaces: [] }), { status: 200 })
    )
    await fetchOwnerWorkspaces()
    const [url, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://control.example.com/api/v1/internal/workspaces')
    expect(String(url)).not.toContain('workspaceId')
    expect(String(url)).not.toContain('instanceId')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  it('transfers ownership with only toEmail in the body', async () => {
    hoisted.fetch.mockResolvedValue(
      new Response(JSON.stringify({ ownerEmail: 'mate@example.com' }), { status: 200 })
    )
    await transferWorkspaceOwnership('mate@example.com')
    const [url, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('/api/v1/internal/ownership')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ toEmail: 'mate@example.com' })
    expect(String(init.body)).not.toContain('workspaceId')
    expect(String(init.body)).not.toContain('instanceId')
  })

  it('posts a usage snapshot without a workspace authority field', async () => {
    hoisted.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await reportWorkspaceUsage({
      month: '2026-07',
      aiTokens: 10,
      emailsSent: 3,
      teamSeatCount: 2,
      pendingInviteCount: 1,
      postCount: 4,
      boardCount: 1,
    })
    const [url, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('/api/v1/internal/usage/report')
    expect(JSON.parse(String(init.body))).toEqual({
      month: '2026-07',
      aiTokens: 10,
      emailsSent: 3,
      teamSeatCount: 2,
      pendingInviteCount: 1,
      postCount: 4,
      boardCount: 1,
    })
    expect(String(init.body)).not.toContain('workspaceId')
  })

  it('loads a seats preview over GET', async () => {
    hoisted.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ amountDueCents: 3156, currency: 'usd', periodEnd: '2026-09-12' }),
        { status: 200 }
      )
    )
    await expect(fetchSeatsPreview(12)).resolves.toEqual({
      amountDueCents: 3156,
      currency: 'usd',
      periodEnd: '2026-09-12',
    })
    const [url, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('/api/v1/internal/billing/seats-preview?quantity=12')
    expect(init.method).toBe('GET')
  })

  it('treats a null seats preview as omitted due-today', async () => {
    hoisted.fetch.mockResolvedValue(
      new Response(JSON.stringify({ amountDueCents: null }), { status: 200 })
    )
    await expect(fetchSeatsPreview(12)).resolves.toEqual({ amountDueCents: null })
  })

  it('returns updated when a seat quantity change does not need checkout', async () => {
    hoisted.fetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 'updated' }), { status: 200 })
    )
    await expect(createHostedBillingSession({ action: 'seats', quantity: 12 })).resolves.toEqual({
      status: 'updated',
    })
  })

  it('pushes desired seats without a workspace authority field', async () => {
    hoisted.fetch.mockResolvedValue(new Response(JSON.stringify({ kept: 2 }), { status: 200 }))
    await pushWorkspaceMembership(['admin@acme.test', 'mate@acme.test'])
    const [url, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('/api/v1/internal/membership/reconcile')
    expect(JSON.parse(String(init.body))).toEqual({
      emails: ['admin@acme.test', 'mate@acme.test'],
    })
    expect(String(init.body)).not.toContain('workspaceId')
    expect(String(init.body)).not.toContain('instanceId')
  })

  it('leaves with only the actor email in the body', async () => {
    hoisted.fetch.mockResolvedValue(new Response(JSON.stringify({ left: true }), { status: 200 }))
    await leaveCloudWorkspace('mate@example.com')
    const [url, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('/api/v1/internal/membership/leave')
    expect(JSON.parse(String(init.body))).toEqual({ email: 'mate@example.com' })
    expect(String(init.body)).not.toContain('workspaceId')
  })

  it('opens a sibling with only instanceId in the body', async () => {
    hoisted.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ url: 'https://south63792f.quackback.co.uk/auth/open-handoff?ott=x' }),
        { status: 200 }
      )
    )
    await expect(openOwnerWorkspace('inst_south')).resolves.toMatch(/^https:\/\//)
    const [url, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('/api/v1/internal/workspaces/open')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ instanceId: 'inst_south' })
    expect(String(init.body)).not.toContain('workspaceId')
    expect(String(init.body)).not.toContain('returnUrl')
  })

  it('transfers ownership with only toEmail', async () => {
    hoisted.fetch.mockResolvedValue(
      new Response(JSON.stringify({ ownerEmail: 'mate@example.com' }), { status: 200 })
    )
    await transferWorkspaceOwnership('mate@example.com')
    const [, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(String(hoisted.fetch.mock.calls[0][0])).toContain('/api/v1/internal/ownership')
    expect(JSON.parse(String(init.body))).toEqual({ toEmail: 'mate@example.com' })
    expect(String(init.body)).not.toContain('workspaceId')
  })

  it('leaves with only email', async () => {
    hoisted.fetch.mockResolvedValue(new Response(JSON.stringify({ left: true }), { status: 200 }))
    await leaveCloudWorkspace('mate@example.com')
    expect(JSON.parse(String((hoisted.fetch.mock.calls[0] as [URL, RequestInit])[1].body))).toEqual(
      {
        email: 'mate@example.com',
      }
    )
  })

  it('wipes with only confirm wipe and no workspace id', async () => {
    hoisted.fetch.mockResolvedValue(new Response(JSON.stringify({ wiped: true }), { status: 200 }))
    await wipeCloudWorkspace()
    const [url, init] = hoisted.fetch.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('/api/v1/internal/lifecycle/soft-delete')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ confirm: 'wipe' })
    expect(String(init.body)).not.toContain('workspaceId')
    expect(String(init.body)).not.toContain('instanceId')
  })
})
