// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { ClaimMappingCard } from '../claim-mapping-card'
import {
  applyClaimMappingEdits,
  effectiveProfileSignature,
} from '@/lib/shared/sso-claim-mapping-edit'
import { connectionAffectingChange } from '@/lib/server/domains/settings/identity-providers.service'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

const { mappingSpy, openTest, ssoTestRef } = vi.hoisted(() => ({
  mappingSpy: vi.fn(
    async (_args: {
      data: {
        expectedClaimMapping: unknown
        operations: unknown[]
        acknowledgeIdentifierChange?: boolean
        acknowledgeAdminRules?: boolean
      }
    }) => undefined
  ),
  openTest: vi.fn(),
  ssoTestRef: {
    lastSuccess: null as null | import('@/lib/shared/sso-test-capture').SsoTestCapture,
    lastCapture: null as null | import('@/lib/shared/sso-test-capture').SsoTestCapture,
  },
}))

vi.mock('../../sso/use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({
    open: openTest,
    lastSuccess: ssoTestRef.lastSuccess,
    lastCapture: ssoTestRef.lastCapture,
  }),
  SsoTestSignInProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/lib/server/functions/sso', () => ({
  upsertIdentityProviderFn: vi.fn(),
  saveIdentityProviderClaimMappingFn: mappingSpy,
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    userAttributes: () => ({
      queryKey: ['admin', 'userAttributes'],
      queryFn: async () => [
        {
          id: 'ua_1',
          key: 'department',
          label: 'Department',
          type: 'string',
          description: null,
          currencyCode: null,
          externalKey: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
      staleTime: Infinity,
    }),
  },
}))

vi.mock('../../sso/test-sign-in-button', () => ({
  TestSignInButton: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children ?? 'Test sign-in'}</button>
  ),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeProvider(over: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    id: 'idp_x' as IdentityProviderId,
    registrationId: 'oidc_x',
    label: 'Acme SSO',
    kind: null,
    configured: true,
    discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
    authorizationUrl: null,
    tokenUrl: null,
    userInfoUrl: null,
    jwksUri: null,
    issuer: null,
    clientId: 'client-id',
    scopes: null,
    prompt: null,
    tokenEndpointAuthMethod: null,
    enabled: true,
    autoCreateUsers: true,
    autoProvisionRole: 'user',
    claimMapping: null,
    showButton: false,
    logoKey: null,
    logoUrl: null,
    detailsChangedAt: '2026-08-01T00:00:00.000Z',
    lastSuccessfulTestAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-05-01T00:00:00.000Z',
    domains: [],
    visibility: 'button',
    lastTestCapture: {
      version: 2,
      registrationId: 'oidc_x',
      capturedAt: '2026-09-01T00:00:00.000Z',
      detailsChangedAtAtStart: '2026-08-01T00:00:00.000Z',
      outcome: 'success',
      identity: {
        id: 'person-123',
        email: 'jane@example.test',
        name: 'Jane',
        sources: { id: 'idToken', email: 'idToken' },
      },
      claims: { sub: 'person-123', email: 'jane@example.test', groups: ['engineering'] },
      replay: {
        sources: [
          {
            source: 'idToken',
            claims: { sub: 'person-123', email: 'jane@example.test', groups: ['engineering'] },
          },
          { source: 'userinfo', claims: { sub: 'person-123' } },
        ],
      },
    },
    ...over,
  }
}

function renderCard(provider: IdentityProvider, presentation?: 'table' | 'legacy') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(
    ['admin', 'userAttributes'],
    [
      {
        id: 'ua_1',
        key: 'department',
        label: 'Department',
        type: 'string',
        description: null,
        currencyCode: null,
        externalKey: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]
  )
  return render(
    <QueryClientProvider client={qc}>
      <ClaimMappingCard provider={provider} presentation={presentation ?? 'table'} />
    </QueryClientProvider>
  )
}

const lastMapping = () => mappingSpy.mock.calls.at(-1)![0].data
const lastSaved = () =>
  applyClaimMappingEdits(
    lastMapping().expectedClaimMapping,
    lastMapping()
      .operations as import('@/lib/shared/sso-claim-mapping-edit').ClaimMappingOperation[]
  )

beforeEach(() => {
  mappingSpy.mockClear()
  mappingSpy.mockResolvedValue(undefined)
  openTest.mockClear()
  ssoTestRef.lastSuccess = null
  ssoTestRef.lastCapture = null
})

describe('ClaimMappingCard save coordination', () => {
  it('keeps the mapping table above the test preview instead of a side column', () => {
    renderCard(makeProvider())
    const table = screen.getAllByRole('table')[0]
    const preview = document.querySelector('[data-preview-slot]')
    expect(preview).toBeTruthy()
    expect(table.compareDocumentPosition(preview!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(preview!.className).not.toMatch(/lg:w-\[22rem\]/)
    expect(preview!.parentElement?.className).not.toMatch(/lg:flex-row/)
    expect(screen.getByRole('heading', { name: 'Last test sign-in' })).toBeInTheDocument()
  })

  it('Edit+Apply on the default identifier does not persist claims.id', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Unique user identifier mapping' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeIdentifierChange).toBeUndefined()
    expect(lastMapping().operations).toEqual([])
    const saved = lastSaved() as { profile?: { claims?: { id?: string } } } | null
    expect(saved?.profile?.claims?.id).toBeUndefined()
  })

  it('selecting sub from the default identifier dialog persists explicit id and requires acknowledgement', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Unique user identifier mapping' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'IdP claim path' }))
    await userEvent.click(screen.getByRole('option', { name: /^sub\b/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText(/stop existing account matches/)).toBeInTheDocument()
    expect(mappingSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeIdentifierChange).toBe(true)
    const saved = lastSaved() as { profile?: { claims?: { id?: string } } }
    expect(saved.profile?.claims?.id).toBe('sub')
  })

  it('keeps provider A session success when lastCapture is a mapping failure for B', () => {
    const captureA = {
      version: 2 as const,
      registrationId: 'oidc_x',
      capturedAt: '2026-09-03T00:00:00.000Z',
      detailsChangedAtAtStart: null,
      outcome: 'success' as const,
      identity: {
        id: 'alice',
        email: 'alice@a.test',
        sources: { id: 'idToken' as const, email: 'idToken' as const },
      },
      claims: { sub: 'alice', email: 'alice@a.test' },
      replay: {
        sources: [{ source: 'idToken' as const, claims: { sub: 'alice', email: 'alice@a.test' } }],
      },
    }
    ssoTestRef.lastSuccess = captureA
    ssoTestRef.lastCapture = {
      version: 2,
      registrationId: 'oidc_b',
      capturedAt: '2026-09-04T00:00:00.000Z',
      detailsChangedAtAtStart: null,
      outcome: 'mapping_failed',
      claims: { sub: 'bob' },
      replay: { sources: [{ source: 'idToken', claims: { sub: 'bob' } }] },
    }
    renderCard(makeProvider({ lastTestCapture: makeProvider().lastTestCapture }))
    expect(screen.getAllByText('alice@a.test').length).toBeGreaterThan(0)
    expect(screen.queryByText('jane@example.test')).not.toBeInTheDocument()
    expect(screen.queryByText('bob')).not.toBeInTheDocument()
  })

  it('id-path change requires explicit user-facing confirmation', async () => {
    renderCard(makeProvider({ claimMapping: { profile: { claims: { id: 'oid' } } } }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Unique user identifier mapping' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reset to sub' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText(/stop existing account matches/)).toBeInTheDocument()
    expect(mappingSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeIdentifierChange).toBe(true)
  })

  it('admin role mapping requires confirmation even when preview is member', async () => {
    renderCard(
      makeProvider({
        claimMapping: {
          role: {
            claimPath: 'groups',
            rules: [
              { whenContains: 'platform-admins', role: 'admin' },
              { whenContains: 'engineering', role: 'member' },
            ],
          },
        },
      })
    )
    await userEvent.click(screen.getByLabelText(/allow accounts without an email/i))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      screen.getByText(/grant admin access even when the person's email is outside/)
    ).toBeInTheDocument()
    expect(screen.getAllByText(/does not limit this admin rule/).length).toBeGreaterThan(0)
    expect(mappingSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeAdminRules).toBe(true)
  })

  it('canceling either confirmation performs no write', async () => {
    renderCard(makeProvider({ claimMapping: { profile: { claims: { id: 'oid' } } } }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Unique user identifier mapping' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reset to sub' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mappingSpy).not.toHaveBeenCalled()
    expect(openTest).not.toHaveBeenCalled()
  })

  it('editing the draft invalidates previous confirmation', async () => {
    renderCard(makeProvider({ claimMapping: { profile: { claims: { id: 'oid' } } } }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Unique user identifier mapping' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reset to sub' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByLabelText(/allow accounts without an email/i))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText(/stop existing account matches/)).toBeInTheDocument()
    expect(mappingSpy).not.toHaveBeenCalled()
  })

  it('reset confirms identifier risk and preserves roles People sources and missing-email policy', async () => {
    renderCard(
      makeProvider({
        claimMapping: {
          profile: {
            claims: { id: 'oid', email: 'upn' },
            sources: ['userinfo', 'idToken'],
            allowMissingEmail: true,
          },
          role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] },
          attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
        },
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset profile claims' }))
    expect(
      screen.getByText(/Keep source order, missing-email policy, Role and People mappings/)
    ).toBeInTheDocument()
    expect(screen.getByText(/stop existing account matches/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset profile claims' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    const saved = lastSaved() as {
      profile?: {
        claims?: { id?: string; email?: string }
        sources?: string[]
        allowMissingEmail?: boolean
      }
      role?: { claimPath?: string }
      attributes?: { map?: unknown[] }
    }
    expect(saved.profile?.claims?.id).toBeUndefined()
    expect(saved.profile?.claims?.email).toBeUndefined()
    expect(saved.profile?.sources).toEqual(['userinfo', 'idToken'])
    expect(saved.profile?.allowMissingEmail).toBe(true)
    expect(saved.role?.claimPath).toBe('groups')
    expect(saved.attributes?.map).toEqual([{ claimPath: 'dept', attributeKey: 'department' }])
  })

  it('default Save with Advanced sources mounted preserves a passing connection test', async () => {
    const provider = makeProvider({ claimMapping: null })
    renderCard(provider)
    expect(screen.getByText('Advanced sources')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().operations).toEqual([])
    const next = lastSaved()
    expect(effectiveProfileSignature(next)).toBe(effectiveProfileSignature(null))
    expect(
      connectionAffectingChange(
        { claimMapping: next as IdentityProvider['claimMapping'] },
        {
          clientId: provider.clientId,
          discoveryUrl: provider.discoveryUrl,
          authorizationUrl: null,
          tokenUrl: null,
          userInfoUrl: null,
          jwksUri: null,
          issuer: null,
          scopes: null,
          prompt: null,
          tokenEndpointAuthMethod: null,
          claimMapping: null,
        }
      )
    ).toBe(false)
  })

  it('Save and test waits for acknowledged persisted mapping', async () => {
    let resolveSave: (value: undefined) => void = () => undefined
    mappingSpy.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveSave = resolve
        })
    )
    renderCard(makeProvider({ claimMapping: null }))
    await userEvent.click(screen.getByLabelText(/allow accounts without an email/i))
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(openTest).not.toHaveBeenCalled()
    resolveSave(undefined)
    await waitFor(() => expect(openTest).toHaveBeenCalledWith({ registrationId: 'oidc_x' }))
  })

  it('stale save keeps the draft and does not open test', async () => {
    mappingSpy.mockRejectedValueOnce(
      new Error('This mapping was updated elsewhere. Reload and try again.')
    )
    renderCard(makeProvider({ claimMapping: null }))
    await userEvent.click(screen.getByLabelText(/allow accounts without an email/i))
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(openTest).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/allow accounts without an email/i)).toBeChecked()
  })

  it('legacy presentation preserves mappings and uses the same confirmations', async () => {
    renderCard(
      makeProvider({
        claimMapping: {
          role: {
            claimPath: 'groups',
            rules: [{ whenContains: 'platform-admins', role: 'admin' }],
          },
          attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
        },
      }),
      'legacy'
    )
    expect(screen.getByRole('button', { name: /Map roles from claims/ })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText(/allow accounts without an email/i))
    fireEvent.click(screen.getByRole('button', { name: 'Save claim mapping' }))
    expect(screen.getByText(/grant admin access/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    const saved = lastSaved() as {
      role?: { claimPath?: string }
      attributes?: { map?: unknown[] }
      profile?: { allowMissingEmail?: boolean }
    }
    expect(saved.role?.claimPath).toBe('groups')
    expect(saved.attributes?.map).toEqual([{ claimPath: 'dept', attributeKey: 'department' }])
    expect(saved.profile?.allowMissingEmail).toBe(true)
    expect(lastMapping().acknowledgeAdminRules).toBe(true)
  })

  it('editing the second duplicate People row updates that row', async () => {
    renderCard(
      makeProvider({
        claimMapping: {
          attributes: {
            map: [
              { claimPath: 'dept', attributeKey: 'department' },
              { claimPath: 'org.department', attributeKey: 'department' },
            ],
          },
        },
      })
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Department mapping' })[1])
    fireEvent.click(screen.getByRole('combobox', { name: 'IdP claim path' }))
    fireEvent.change(screen.getByPlaceholderText('Search or type…'), {
      target: { value: 'costCenter' },
    })
    fireEvent.click(screen.getByText(/Use ["“]costCenter["”]/))
    fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(
      (lastSaved() as { attributes?: { map?: Array<{ claimPath: string; attributeKey: string }> } })
        .attributes?.map
    ).toEqual([
      { claimPath: 'dept', attributeKey: 'department' },
      { claimPath: 'costCenter', attributeKey: 'department' },
    ])
  })
})
