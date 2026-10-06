// @vitest-environment happy-dom
/**
 * <UserDetailsCard>, titled Profile: the mapping table is always open. Edits
 * change a draft; Cancel and Save changes appear only while the draft differs
 * from what is stored. Save diffs operations against the stored JSON, and the
 * two risky edits (Account ID, new admin rules) still confirm before writing.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
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

// happy-dom never loads images and reports every one as already failed;
// keep them loading so a test drives failure with an error event.
Object.defineProperty(HTMLImageElement.prototype, 'complete', {
  configurable: true,
  get: () => false,
})

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
    label: 'Acme ID',
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
    idTokenNonce: null,
    enabled: true,
    autoCreateUsers: true,
    autoProvisionRole: 'user',
    claimMapping: null,
    redirectStyle: 'current',
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

/**
 * A stand-in for the server and the providers query: Save applies its
 * operations (refusing a stale `expectedClaimMapping` the way the service
 * does), and the card reads its provider from the query cache, so the refetch
 * after Save lands as it does on the page.
 */
const server = {
  provider: null as IdentityProvider | null,
  qc: null as QueryClient | null,
}

const PROVIDERS_KEY = ['settings', 'identityProviders']

async function serverSave({
  data,
}: {
  data: { expectedClaimMapping: unknown; operations: unknown[] }
}): Promise<undefined> {
  const current = server.provider!
  if (
    JSON.stringify(data.expectedClaimMapping ?? null) !==
    JSON.stringify(current.claimMapping ?? null)
  ) {
    throw new Error('This mapping was updated elsewhere. Reload and try again.')
  }
  server.provider = {
    ...current,
    claimMapping: applyClaimMappingEdits(
      current.claimMapping,
      data.operations as import('@/lib/shared/sso-claim-mapping-edit').ClaimMappingOperation[]
    ) as IdentityProvider['claimMapping'],
  }
  return undefined
}

function CardFromCache({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: async () => [server.provider!],
    staleTime: Infinity,
  })
  const provider = data?.find((p) => p.id === id)
  return provider ? <UserDetailsCard provider={provider} /> : null
}

function renderCard(provider: IdentityProvider) {
  server.provider = provider
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['admin', 'userAttributes'], [DEPARTMENT])
  qc.setQueryData(PROVIDERS_KEY, [provider])
  server.qc = qc
  return render(
    <QueryClientProvider client={qc}>
      <CardFromCache id={provider.id} />
    </QueryClientProvider>
  )
}

/** Another admin, or another card on the page, writes the stored mapping. */
async function changeElsewhere(claimMapping: IdentityProvider['claimMapping']) {
  server.provider = { ...server.provider!, claimMapping }
  await act(async () => {
    server.qc!.setQueryData(PROVIDERS_KEY, [server.provider])
    // The query notifies its observers on a timer.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
const saveButton = () => screen.queryByRole('button', { name: 'Save changes' })
const cancelButton = () => screen.queryByRole('button', { name: 'Cancel' })
const confirmSave = () =>
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Save changes' })
  )
const editAccountId = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Edit Account ID mapping' }))
/** Add mapping → Department ← `dept`, committed to the draft. */
const addDepartmentMapping = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }))
  await userEvent.click(screen.getByRole('combobox', { name: 'Set from this provider' }))
  await userEvent.click(screen.getByRole('option', { name: /Department/ }))
  await userEvent.click(screen.getByRole('combobox', { name: 'Provider claim' }))
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
  mappingSpy.mockReset()
  mappingSpy.mockImplementation(serverSave)
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
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // No operations, so nothing to save or cancel.
    expect(saveButton()).not.toBeInTheDocument()
    expect(cancelButton()).not.toBeInTheDocument()
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
    await addDepartmentMapping()
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
    expect(saveButton()).not.toBeInTheDocument()
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
          idTokenNonce: null,
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
    await addDepartmentMapping()
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
    await addDepartmentMapping()
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(openTest).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit Department mapping' })).toBeInTheDocument()
    expect(saveButton()).toBeInTheDocument()
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

const syncBox = () =>
  screen.getByRole('checkbox', { name: 'Update name and avatar on every sign-in' })

function captureWith(claims: Record<string, import('@/lib/shared/json').JsonValue>) {
  const base = makeProvider().lastTestCapture!
  return {
    ...base,
    claims,
    replay: {
      sources: [
        { source: 'idToken' as const, claims },
        { source: 'userinfo' as const, claims: { sub: 'person-123' } },
      ],
    },
  }
}

describe('UserDetailsCard profile sync', () => {
  it('is off by default and says profiles are set once', () => {
    renderCard(makeProvider())
    expect(syncBox()).not.toBeChecked()
    expect(
      screen.getByText('Name and avatar are set when an account is created.')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Email and name are set when an account is created.')
    ).not.toBeInTheDocument()
  })

  it('turning it on saves a profile sync operation', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    await userEvent.click(syncBox())
    expect(syncBox()).toBeChecked()
    expect(
      screen.getByText(
        'Keeps profiles in step with your provider. Names or pictures someone changed in Quackback are kept.'
      )
    ).toBeInTheDocument()
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastMapping().operations).toEqual([{ op: 'setProfileSync', syncOnSignIn: true }])
    expect(lastSaved()).toEqual({ profile: { syncOnSignIn: true } })
  })

  it('turning a stored sync off saves it off', async () => {
    renderCard(makeProvider({ claimMapping: { profile: { syncOnSignIn: true } } }))
    expect(syncBox()).toBeChecked()
    await userEvent.click(syncBox())
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().operations).toEqual([{ op: 'setProfileSync', syncOnSignIn: false }])
    expect(lastSaved()).toBeNull()
  })
})

describe('UserDetailsCard test sign-in column', () => {
  it('shows what each field took from the last test sign-in, once there is one', () => {
    const untested = renderCard(makeProvider({ lastTestCapture: null }))
    expect(
      screen.queryByRole('columnheader', { name: 'Last test sign-in' })
    ).not.toBeInTheDocument()
    untested.unmount()
    renderCard(makeProvider())
    expect(screen.getByRole('columnheader', { name: 'Last test sign-in' })).toBeInTheDocument()
    expect(screen.getAllByText('person-123').length).toBeGreaterThan(0)
    expect(screen.getByText('Not sent, initials are shown')).toBeInTheDocument()
    expect(screen.getByText('Name is used')).toBeInTheDocument()
  })

  it('maps the avatar from a claim in the test sign-in and previews it in the table', async () => {
    renderCard(
      makeProvider({
        claimMapping: null,
        lastTestCapture: captureWith({
          sub: 'person-123',
          email: 'jane@example.test',
          name: 'Jane',
          photo_url: 'https://cdn.example.com/photos/123',
        }),
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Avatar mapping' }))
    const dialog = screen.getByRole('dialog')
    const list = within(dialog).getByRole('list', { name: 'Claims in your last test sign-in' })
    const photo = within(list)
      .getAllByRole('button')
      .find((b) => b.querySelector('code')?.textContent === 'photo_url')!
    await userEvent.click(photo)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    const avatarRow = screen.getByText('Avatar', { selector: 'span' }).closest('tr')!
    expect(within(avatarRow).getByText('photo_url')).toBeInTheDocument()
    expect(within(avatarRow).getByText('https://cdn.example.com/photos/123')).toBeInTheDocument()
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().operations).toEqual([
      { op: 'setProfileClaim', field: 'image', path: 'photo_url' },
    ])
  })
})

describe('UserDetailsCard always open', () => {
  it('shows the Profile table with no click and no Customize button', () => {
    renderCard(makeProvider({ claimMapping: null }))
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(
      screen.getByText('What Quackback takes from Acme ID for each person.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'User details' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument()
    expect(screen.queryByText('Uses standard profile fields')).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Field',
      'Acme ID claim',
      'Last test sign-in',
      'Actions',
    ])
    for (const label of ['Account ID', 'Email', 'Name', 'Username', 'Avatar']) {
      expect(screen.getByRole('button', { name: `Edit ${label} mapping` })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Add mapping' })).toBeInTheDocument()
    expect(syncBox()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Compatibility/ })).toBeInTheDocument()
  })

  it('falls back to Provider claim when the provider has no label', () => {
    renderCard(makeProvider({ label: '' }))
    expect(screen.getByRole('columnheader', { name: 'Provider claim' })).toBeInTheDocument()
  })

  it('shows Cancel and Save changes only once the draft differs from what is saved', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    expect(saveButton()).not.toBeInTheDocument()
    expect(cancelButton()).not.toBeInTheDocument()
    await userEvent.click(syncBox())
    expect(saveButton()).toBeInTheDocument()
    expect(cancelButton()).toBeInTheDocument()
    // Undoing the edit by hand makes the draft clean again.
    await userEvent.click(syncBox())
    expect(saveButton()).not.toBeInTheDocument()
  })

  it('Cancel reverts the draft and writes nothing', async () => {
    renderCard(
      makeProvider({
        claimMapping: {
          attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
        },
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Department mapping' }))
    expect(screen.queryByText('dept')).not.toBeInTheDocument()
    fireEvent.click(cancelButton()!)
    expect(screen.getByText('dept')).toBeInTheDocument()
    expect(saveButton()).not.toBeInTheDocument()
    expect(cancelButton()).not.toBeInTheDocument()
    expect(mappingSpy).not.toHaveBeenCalled()
  })

  it('Save persists the draft, keeps it showing and hides the footer', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    await addDepartmentMapping()
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastSaved()).toEqual({
      attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
    })
    await waitFor(() => expect(saveButton()).not.toBeInTheDocument())
    expect(cancelButton()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Department mapping' })).toBeInTheDocument()
    expect(toastSpy.success).toHaveBeenCalledWith('Profile saved.')
  })

  it('a confirmation still gates Save, and the footer stays until it is accepted', async () => {
    renderCard(makeProvider({ claimMapping: { profile: { claims: { id: 'oid' } } } }))
    editAccountId()
    await userEvent.click(screen.getByRole('button', { name: 'Use sub' }))
    save()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/Changing the Account ID/)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mappingSpy).not.toHaveBeenCalled()
    expect(saveButton()).toBeInTheDocument()
  })

  it('a stored mapping that changes under a clean draft is shown, not reverted', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    await changeElsewhere({
      attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
    })
    expect(screen.getByRole('button', { name: 'Edit Department mapping' })).toBeInTheDocument()
    expect(saveButton()).not.toBeInTheDocument()
  })

  it('keeps the notes the resting summary used to carry', () => {
    renderCard(
      makeProvider({
        autoCreateUsers: false,
        claimMapping: {
          profile: { claims: { email: '  ' }, sources: ['idToken', 'userinfo', 'accessTokenJwt'] },
          role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] },
        },
      })
    )
    expect(screen.getByText('Email mapping has no claim path')).toBeInTheDocument()
    expect(
      screen.getByText('Role rules are not applied while account creation is off.')
    ).toBeInTheDocument()
  })
})

describe('UserDetailsCard review fixes', () => {
  it.each([
    ['an explicit standard claim', { profile: { claims: { email: 'email' } } }],
    ['a role section with no rules', { role: { claimPath: 'groups', rules: [] } }],
    ['People flags with no rows', { attributes: { overrideExisting: true } }],
  ])('is clean on load for %s', (_name, claimMapping) => {
    renderCard(makeProvider({ claimMapping: claimMapping as IdentityProvider['claimMapping'] }))
    expect(saveButton()).not.toBeInTheDocument()
    expect(cancelButton()).not.toBeInTheDocument()
  })

  it('follows a section changed elsewhere that the admin did not edit', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    await addDepartmentMapping()
    const role = { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' as const }] }
    await changeElsewhere({ role })
    expect(screen.getByRole('button', { name: 'Edit role rules' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Department mapping' })).toBeInTheDocument()
    expect(screen.queryByText(/changed elsewhere/)).not.toBeInTheDocument()
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    await waitFor(() => expect(saveButton()).not.toBeInTheDocument())
    expect(server.provider!.claimMapping).toEqual({
      role,
      attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
    })
  })

  it('flags an edited section that changed elsewhere and refuses to overwrite it', async () => {
    renderCard(makeProvider({ claimMapping: null }))
    await addDepartmentMapping()
    const theirs = { attributes: { map: [{ claimPath: 'cost', attributeKey: 'department' }] } }
    await changeElsewhere(theirs)
    expect(
      screen.getByText("This provider's profile settings changed elsewhere. Review before saving.")
    ).toBeInTheDocument()
    save()
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalled())
    expect(toastSpy.error.mock.calls[0][0]).toMatch(/Reload/)
    expect(server.provider!.claimMapping).toEqual(theirs)
    // Cancel takes the stored mapping and clears the notice.
    fireEvent.click(cancelButton()!)
    expect(screen.queryByText(/changed elsewhere/)).not.toBeInTheDocument()
    expect(screen.getByText('cost')).toBeInTheDocument()
  })

  it('reads as saved only once the stored mapping says so', async () => {
    // The write is accepted but the refetch still returns the old mapping.
    mappingSpy.mockImplementationOnce(async () => undefined)
    renderCard(makeProvider({ claimMapping: null }))
    await userEvent.click(syncBox())
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    await waitFor(() => expect(saveButton()).not.toBeDisabled())
    expect(saveButton()).toBeInTheDocument()
    expect(syncBox()).toBeChecked()
  })

  it('clears a blank stored path from the field dialog', async () => {
    renderCard(makeProvider({ claimMapping: { profile: { claims: { email: '  ' } } } }))
    expect(screen.getByText('Email mapping has no claim path')).toBeInTheDocument()
    expect(saveButton()).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Email mapping' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use email' }))
    await waitFor(() => expect(saveButton()).toBeInTheDocument())
    save()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().operations).toEqual([{ op: 'resetProfileClaim', field: 'email' }])
    await waitFor(() =>
      expect(screen.queryByText('Email mapping has no claim path')).not.toBeInTheDocument()
    )
    expect(saveButton()).not.toBeInTheDocument()
  })

  it('never carries a draft from one provider to another', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['admin', 'userAttributes'], [DEPARTMENT])
    const a = makeProvider({ claimMapping: null })
    const b = makeProvider({ id: 'idp_y' as IdentityProviderId, claimMapping: null })
    const view = render(
      <QueryClientProvider client={qc}>
        <UserDetailsCard provider={a} />
      </QueryClientProvider>
    )
    await addDepartmentMapping()
    expect(saveButton()).toBeInTheDocument()
    view.rerender(
      <QueryClientProvider client={qc}>
        <UserDetailsCard provider={b} />
      </QueryClientProvider>
    )
    expect(saveButton()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Department mapping' })).toBeNull()
  })

  it('Undo restores only what that removal removed', async () => {
    renderCard(
      makeProvider({
        claimMapping: {
          role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] },
          attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
        },
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove role rules' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Department mapping' }))
    const undoRole = (
      toastSpy.mock.calls[0] as unknown as [string, { action: { onClick: () => void } }]
    )[1].action.onClick
    act(() => undoRole())
    expect(screen.getByRole('button', { name: 'Edit role rules' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Department mapping' })).toBeNull()
  })

  it('scrolls the table sideways on a narrow screen instead of the page', () => {
    renderCard(makeProvider())
    expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto')
  })

  it('names non-standard sources once, in the Compatibility summary', () => {
    renderCard(
      makeProvider({
        claimMapping: { profile: { sources: ['idToken', 'userinfo', 'accessTokenJwt'] } },
      })
    )
    expect(screen.queryByTestId('compatibility-sources')).not.toBeInTheDocument()
    // Open by default for a non-standard list; the summary shows once closed.
    fireEvent.click(screen.getByRole('button', { name: /Compatibility/ }))
    expect(screen.getByTestId('compatibility-section')).toHaveTextContent(
      'ID token → Userinfo → Access-token JWT'
    )
  })
})
