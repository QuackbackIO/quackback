// @vitest-environment happy-dom
/**
 * <UserDetailsCard> save coordination: the editor edits a draft, Save diffs
 * operations against the stored JSON, and the two risky edits (Account ID,
 * new admin rules) still confirm before writing.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { UserDetailsCard } from '../user-details-card'
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

const { mappingSpy, openTest, ssoTestRef, toastSpy } = vi.hoisted(() => ({
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
  toastSpy: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
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

const DEPARTMENT = {
  id: 'ua_1',
  key: 'department',
  label: 'Department',
  type: 'string',
  description: null,
  currencyCode: null,
  externalKey: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    userAttributes: () => ({
      queryKey: ['admin', 'userAttributes'],
      queryFn: async () => [DEPARTMENT],
      staleTime: Infinity,
    }),
  },
}))

vi.mock('../../sso/test-sign-in-button', () => ({
  TestSignInButton: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children ?? 'Test sign-in'}</button>
  ),
}))

vi.mock('sonner', () => ({ toast: toastSpy }))

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

function renderCard(provider: IdentityProvider) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['admin', 'userAttributes'], [DEPARTMENT])
  const view = render(
    <QueryClientProvider client={qc}>
      <UserDetailsCard provider={provider} />
    </QueryClientProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
  return view
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
const confirmSave = () =>
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Save changes' })
  )
const editAccountId = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Edit Account ID mapping' }))
/** Add mapping → Department ← `dept`, committed to the draft. */
const addDepartmentMapping = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }))
  fireEvent.click(screen.getByRole('combobox', { name: 'Set from this provider' }))
  fireEvent.click(screen.getByRole('option', { name: /Department/ }))
  fireEvent.click(screen.getByRole('combobox', { name: 'Provider claim' }))
  fireEvent.change(screen.getByPlaceholderText('Search or type…'), { target: { value: 'dept' } })
  fireEvent.click(screen.getByText(/Use ["“]dept["”]/))
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
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
  toastSpy.mockClear()
  ssoTestRef.lastSuccess = null
  ssoTestRef.lastCapture = null
})

describe('UserDetailsCard save coordination', () => {
  it('shows the preview below the table with the last test caption', () => {
    renderCard(makeProvider())
    expect(screen.getByRole('heading', { name: 'Last test sign-in' })).toBeInTheDocument()
    expect(screen.getAllByText('jane@example.test').length).toBeGreaterThan(0)
  })

  it('Edit+Apply on the default Account ID writes nothing', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    editAccountId()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    save()
    // No operations: the editor simply closes.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument()
    )
    expect(mappingSpy).not.toHaveBeenCalled()
  })

  it('choosing sub explicitly persists id and requires acknowledgement', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    editAccountId()
    await userEvent.click(screen.getByRole('combobox', { name: 'Provider claim' }))
    await userEvent.click(screen.getByRole('option', { name: /^sub\b/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    save()
    expect(screen.getByText(/Changing the Account ID/)).toBeInTheDocument()
    expect(mappingSpy).not.toHaveBeenCalled()
    confirmSave()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeIdentifierChange).toBe(true)
    const saved = lastSaved() as { profile?: { claims?: { id?: string } } }
    expect(saved.profile?.claims?.id).toBe('sub')
  })

  it('keeps provider A session success when lastCapture is a mapping failure for B', () => {
    ssoTestRef.lastSuccess = {
      version: 2,
      registrationId: 'oidc_x',
      capturedAt: '2026-09-03T00:00:00.000Z',
      detailsChangedAtAtStart: null,
      outcome: 'success',
      identity: {
        id: 'alice',
        email: 'alice@a.test',
        sources: { id: 'idToken', email: 'idToken' },
      },
      claims: { sub: 'alice', email: 'alice@a.test' },
      replay: { sources: [{ source: 'idToken', claims: { sub: 'alice', email: 'alice@a.test' } }] },
    }
    ssoTestRef.lastCapture = {
      version: 2,
      registrationId: 'oidc_b',
      capturedAt: '2026-09-04T00:00:00.000Z',
      detailsChangedAtAtStart: null,
      outcome: 'mapping_failed',
      claims: { sub: 'bob' },
      replay: { sources: [{ source: 'idToken', claims: { sub: 'bob' } }] },
    }
    renderCard(makeProvider())
    expect(screen.getAllByText('alice@a.test').length).toBeGreaterThan(0)
    expect(screen.queryByText('jane@example.test')).not.toBeInTheDocument()
    expect(screen.queryByText('bob')).not.toBeInTheDocument()
  })

  it('returning a custom Account ID to sub confirms the identifier risk', async () => {
    renderCard(makeProvider({ claimMapping: { profile: { claims: { id: 'oid' } } } }))
    editAccountId()
    await userEvent.click(screen.getByRole('button', { name: 'Use sub' }))
    save()
    expect(screen.getByText(/Changing the Account ID/)).toBeInTheDocument()
    expect(mappingSpy).not.toHaveBeenCalled()
    confirmSave()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeIdentifierChange).toBe(true)
  })

  it('a new admin rule confirms before saving', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }))
    // Role rules is the first available target, so the rules body is showing.
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Claim value to match (rule 1)' }))
    fireEvent.change(screen.getByPlaceholderText('Search or type…'), {
      target: { value: 'platform-admins' },
    })
    fireEvent.click(screen.getByText(/Use ["“]platform-admins["”]/))
    await userEvent.click(screen.getByRole('combobox', { name: 'Quackback role (rule 1)' }))
    await userEvent.click(screen.getByRole('option', { name: 'Admin' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    save()
    expect(screen.getByText(/A rule grants admin access/)).toBeInTheDocument()
    expect(mappingSpy).not.toHaveBeenCalled()
    confirmSave()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeAdminRules).toBe(true)
    const saved = lastSaved() as { role?: { rules?: unknown[] } }
    expect(saved.role?.rules).toEqual([{ whenContains: 'platform-admins', role: 'admin' }])
  })

  it('an unrelated edit beside an existing admin rule is acknowledged, not re-confirmed', async () => {
    renderCard(
      makeProvider({
        claimMapping: {
          role: {
            claimPath: 'groups',
            rules: [{ whenContains: 'platform-admins', role: 'admin' }],
          },
        },
      })
    )
    addDepartmentMapping()
    save()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeAdminRules).toBe(true)
  })

  it('cancelling the confirmation performs no write', async () => {
    renderCard(makeProvider({ claimMapping: { profile: { claims: { id: 'oid' } } } }))
    editAccountId()
    await userEvent.click(screen.getByRole('button', { name: 'Use sub' }))
    save()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(mappingSpy).not.toHaveBeenCalled()
    expect(openTest).not.toHaveBeenCalled()
  })

  it('Use standard profile fields resets the profile and keeps roles, People and sources', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Use standard profile fields' }))
    save()
    confirmSave()
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

  it('an untouched editor with Compatibility open would not invalidate a passing test', () => {
    const provider = makeProvider({ claimMapping: null })
    renderCard(provider)
    fireEvent.click(screen.getByRole('button', { name: /Compatibility/ }))
    expect(screen.getByTestId('identity-sources-editor')).toBeInTheDocument()
    save()
    expect(mappingSpy).not.toHaveBeenCalled()
    expect(effectiveProfileSignature(null)).toBe(effectiveProfileSignature(provider.claimMapping))
    expect(
      connectionAffectingChange(
        { claimMapping: null },
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

  it('changing sources confirms as an identifier change', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    fireEvent.click(screen.getByRole('button', { name: /Compatibility/ }))
    await userEvent.click(screen.getByLabelText('Access-token JWT'))
    save()
    expect(screen.getByText(/Changing the Account ID/)).toBeInTheDocument()
    confirmSave()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeIdentifierChange).toBe(true)
    expect((lastSaved() as { profile?: { sources?: string[] } }).profile?.sources).toEqual([
      'idToken',
      'userinfo',
      'accessTokenJwt',
    ])
  })

  it('Save and test waits for the persisted mapping before opening the test', async () => {
    let resolveSave: (value: undefined) => void = () => undefined
    mappingSpy.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveSave = resolve
        })
    )
    renderCard(makeProvider({ claimMapping: null }))
    addDepartmentMapping()
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(openTest).not.toHaveBeenCalled()
    resolveSave(undefined)
    await waitFor(() => expect(openTest).toHaveBeenCalled())
    expect(openTest.mock.calls[0][0]).toMatchObject({ registrationId: 'oidc_x' })
  })

  it('a stale save keeps the draft open and does not open the test', async () => {
    mappingSpy.mockRejectedValueOnce(
      new Error('This mapping was updated elsewhere. Reload and try again.')
    )
    renderCard(makeProvider({ claimMapping: null }))
    addDepartmentMapping()
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(openTest).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit Department mapping' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('combobox', { name: 'Provider claim' }))
    fireEvent.change(screen.getByPlaceholderText('Search or type…'), {
      target: { value: 'costCenter' },
    })
    fireEvent.click(screen.getByText(/Use ["“]costCenter["”]/))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    save()
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
