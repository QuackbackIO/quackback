/**
 * Tests for updatePortalAccessFn:
 *   - Auth gate: non-admin callers are rejected.
 *   - Audit events: visibility change, domain change, no-op (no event).
 *   - Domain normalization via the fn's normalization pipeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
  mockGetPortalConfig: vi.fn(),
  mockUpdatePortalConfig: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.mockRecordAuditEvent,
  actorFromAuth: (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
  }),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: hoisted.mockGetPortalConfig,
  updatePortalConfig: hoisted.mockUpdatePortalConfig,
}))

// updatePortalAccessFn is handler index 0 in portal-access.ts
// (the first createServerFn without inputValidator captures evaluateMyPortalAccessFn,
//  but it has no inputValidator so it's just .handler; the second has inputValidator
//  — resolving: we import the module and check which handler it is)
// Actually: evaluateMyPortalAccessFn uses createServerFn({ method: 'GET' }).handler(...)  → pushes 1 handler
//           updatePortalAccessFn uses createServerFn({ method: 'POST' }).inputValidator(...).handler(...) → pushes 1 handler
// So handlers[0] = evaluateMyPortalAccess, handlers[1] = updatePortalAccess.

const UPDATE_PORTAL_ACCESS = 1

let updatePortalAccessHandler: AnyHandler

const ADMIN_AUTH = {
  user: { id: 'user_admin', email: 'admin@acme.com', name: 'Admin' },
  principal: { id: 'principal_admin', role: 'admin', type: 'user' },
  settings: { id: 'ws_1', slug: 'acme', name: 'Acme', logoKey: null },
}

const MEMBER_AUTH = {
  user: { id: 'user_member', email: 'member@acme.com', name: 'Member' },
  principal: { id: 'principal_member', role: 'member', type: 'user' },
  settings: { id: 'ws_1', slug: 'acme', name: 'Acme', logoKey: null },
}

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlers.length === 0) {
    await import('../portal-access')
  }
  updatePortalAccessHandler = handlers[UPDATE_PORTAL_ACCESS]
})

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe('updatePortalAccessFn — auth gate', () => {
  it('rejects a non-admin (member) caller', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(
      new Error('Access denied: Requires [admin], got member')
    )

    await expect(updatePortalAccessHandler({ data: { visibility: 'private' } })).rejects.toThrow(
      'Access denied'
    )
  })

  it('rejects an unauthenticated caller', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(new Error('Authentication required'))

    await expect(updatePortalAccessHandler({ data: { visibility: 'public' } })).rejects.toThrow(
      'Authentication required'
    )
  })

  it('allows an admin caller', async () => {
    hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
    hoisted.mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'public', allowedDomains: [] },
    })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    const result = await updatePortalAccessHandler({ data: { visibility: 'private' } })

    expect(result).toEqual({ visibility: 'private' })
  })

  it('member role is insufficient — requireAuth is called with roles: [admin]', async () => {
    hoisted.mockRequireAuth.mockImplementation((opts?: { roles?: string[] }) => {
      if (opts?.roles && !opts.roles.includes(MEMBER_AUTH.principal.role)) {
        throw new Error(`Access denied: Requires [${opts.roles.join(', ')}], got member`)
      }
      return Promise.resolve(MEMBER_AUTH)
    })

    await expect(updatePortalAccessHandler({ data: { visibility: 'private' } })).rejects.toThrow(
      'Access denied'
    )
  })
})

// ---------------------------------------------------------------------------
// Audit: portal.visibility.changed
// ---------------------------------------------------------------------------

describe('updatePortalAccessFn — audit events', () => {
  it('emits portal.visibility.changed when visibility flips', async () => {
    hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
    hoisted.mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'public', allowedDomains: [] },
    })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    await updatePortalAccessHandler({ data: { visibility: 'private' } })

    const visibilityCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.visibility.changed'
    )
    expect(visibilityCall).toBeDefined()
    expect(visibilityCall![0]).toMatchObject({
      event: 'portal.visibility.changed',
      before: { visibility: 'public' },
      after: { visibility: 'private' },
    })
  })

  it('does NOT emit portal.visibility.changed when visibility is unchanged', async () => {
    hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
    hoisted.mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    await updatePortalAccessHandler({ data: { visibility: 'private' } })

    const visibilityCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.visibility.changed'
    )
    expect(visibilityCall).toBeUndefined()
  })

  it('emits portal.allowed_domains.changed when domains change', async () => {
    hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
    hoisted.mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: ['acme.com'] },
    })

    await updatePortalAccessHandler({
      data: { visibility: 'private', allowedDomains: ['acme.com'] },
    })

    const domainsCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.allowed_domains.changed'
    )
    expect(domainsCall).toBeDefined()
    expect(domainsCall![0]).toMatchObject({
      event: 'portal.allowed_domains.changed',
      before: { allowedDomains: [] },
      after: { allowedDomains: ['acme.com'] },
    })
  })

  it('does NOT emit portal.allowed_domains.changed when domains are unchanged', async () => {
    hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
    hoisted.mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: ['acme.com'] },
    })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: ['acme.com'] },
    })

    await updatePortalAccessHandler({
      data: { visibility: 'private', allowedDomains: ['acme.com'] },
    })

    const domainsCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.allowed_domains.changed'
    )
    expect(domainsCall).toBeUndefined()
  })

  it('emits both events when both visibility and domains change in one call', async () => {
    hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
    hoisted.mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'public', allowedDomains: [] },
    })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: ['acme.com'] },
    })

    await updatePortalAccessHandler({
      data: { visibility: 'private', allowedDomains: ['acme.com'] },
    })

    const events = hoisted.mockRecordAuditEvent.mock.calls.map(
      (c) => (c[0] as { event: string }).event
    )
    expect(events).toContain('portal.visibility.changed')
    expect(events).toContain('portal.allowed_domains.changed')
  })

  it('emits no audit events when both visibility and domains are unchanged', async () => {
    hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
    hoisted.mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'public', allowedDomains: [] },
    })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({
      access: { visibility: 'public', allowedDomains: [] },
    })

    await updatePortalAccessHandler({ data: { visibility: 'public' } })

    // No domains key in payload, so no domain audit; no visibility change.
    expect(hoisted.mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('emits portal.widget_signin.changed when widgetSignIn flips', async () => {
    hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
    hoisted.mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], widgetSignIn: false },
    })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], widgetSignIn: true },
    })

    await updatePortalAccessHandler({ data: { visibility: 'private', widgetSignIn: true } })

    const widgetCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.widget_signin.changed'
    )
    expect(widgetCall).toBeDefined()
    expect(widgetCall![0]).toMatchObject({
      event: 'portal.widget_signin.changed',
      before: { widgetSignIn: false },
      after: { widgetSignIn: true },
    })
  })

  it('does NOT emit portal.widget_signin.changed when widgetSignIn is unchanged', async () => {
    hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
    hoisted.mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], widgetSignIn: true },
    })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], widgetSignIn: true },
    })

    await updatePortalAccessHandler({ data: { visibility: 'private', widgetSignIn: true } })

    const widgetCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.widget_signin.changed'
    )
    expect(widgetCall).toBeUndefined()
  })

  it('does NOT emit portal.widget_signin.changed when widgetSignIn is absent from payload', async () => {
    hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
    hoisted.mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], widgetSignIn: false },
    })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    await updatePortalAccessHandler({ data: { visibility: 'private' } })

    const widgetCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.widget_signin.changed'
    )
    expect(widgetCall).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Domain normalization (exercised through the fn's input pipeline)
// ---------------------------------------------------------------------------

describe('updatePortalAccessFn — domain normalization', () => {
  /**
   * Helper: calls the handler and returns the allowedDomains that were passed
   * to updatePortalConfig (normalized list).
   */
  async function captureNormalizedDomains(rawDomains: string[]): Promise<string[]> {
    hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
    hoisted.mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })
    // Return what we pass so we can inspect the call argument
    hoisted.mockUpdatePortalConfig.mockImplementation(
      (config: { access: { allowedDomains: string[] } }) =>
        Promise.resolve({
          access: { visibility: 'private', allowedDomains: config.access.allowedDomains },
        })
    )

    await updatePortalAccessHandler({
      data: { visibility: 'private', allowedDomains: rawDomains },
    })

    const call = hoisted.mockUpdatePortalConfig.mock.calls[0]
    return (call[0] as { access: { allowedDomains: string[] } }).access.allowedDomains
  }

  it('lowercases uppercase domain entries', async () => {
    const result = await captureNormalizedDomains(['ACME.COM'])
    expect(result).toContain('acme.com')
  })

  it('strips a leading @ from domain entries', async () => {
    const result = await captureNormalizedDomains(['@acme.com'])
    expect(result).toContain('acme.com')
  })

  it('trims leading and trailing whitespace', async () => {
    const result = await captureNormalizedDomains(['  acme.com  '])
    expect(result).toContain('acme.com')
  })

  it('deduplicates entries that normalize to the same value', async () => {
    const result = await captureNormalizedDomains(['acme.com', 'ACME.COM', '  acme.com  '])
    expect(result).toEqual(['acme.com'])
  })

  it('drops entries with no dot (not a valid domain)', async () => {
    const result = await captureNormalizedDomains(['nodot', 'acme.com'])
    expect(result).not.toContain('nodot')
    expect(result).toContain('acme.com')
  })

  it('drops entries that still contain @ after leading-@ strip (full email address)', async () => {
    const result = await captureNormalizedDomains(['user@acme.com', 'acme.com'])
    // 'user@acme.com' contains @ after stripping leading @ (there is none here),
    // so it should be dropped.
    expect(result).not.toContain('user@acme.com')
    expect(result).toContain('acme.com')
  })

  it('drops entries that contain internal whitespace', async () => {
    const result = await captureNormalizedDomains(['ac me.com', 'acme.com'])
    expect(result).not.toContain('ac me.com')
    expect(result).toContain('acme.com')
  })

  it('drops entries that are URLs with a protocol', async () => {
    const result = await captureNormalizedDomains(['https://acme.com', 'acme.com'])
    expect(result).not.toContain('https://acme.com')
    expect(result).toContain('acme.com')
  })

  it('handles an empty allowedDomains array gracefully', async () => {
    const result = await captureNormalizedDomains([])
    expect(result).toEqual([])
  })

  it('normalizes a mix of valid and invalid entries, keeping only valid ones', async () => {
    const result = await captureNormalizedDomains([
      '@PARTNER.IO',
      'http://bad.com',
      'noDot',
      'good@email.passed.by.mistake',
      'valid.org',
    ])
    expect(result).toContain('partner.io')
    expect(result).toContain('valid.org')
    expect(result).not.toContain('http://bad.com')
    expect(result).not.toContain('noDot')
    // full email should be dropped — none of the remaining entries should contain @
    for (const d of result) {
      expect(d).not.toContain('@')
    }
  })
})
