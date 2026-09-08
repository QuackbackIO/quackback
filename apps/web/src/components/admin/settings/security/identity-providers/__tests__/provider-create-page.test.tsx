// @vitest-environment happy-dom
/**
 * <ProviderCreatePage> — "Connect single sign-on", the short half of the split.
 *
 * Two things are load-bearing here. The redirect URI must precede the
 * credential fields, because it is the input to the IdP registration that
 * produces them; presenting it afterwards is how `redirect_uri_mismatch` gets
 * discovered on the first real sign-in instead of during setup. And nothing
 * that needs a saved provider — domains, enforcement, the connection test,
 * user details — may appear before the row exists.
 *
 * "Save and test" saves the row (and the secret) and then hands off to the
 * detail page, which opens the test only when the saved configuration is
 * complete enough to test.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProviderCreatePage } from '../provider-create-page'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
})

const { upsertSpy, credentialsSpy, navigateSpy } = vi.hoisted(() => ({
  upsertSpy: vi.fn(
    async (_args: { data: { registrationId: string; label: string; clientId: string } }) => ({
      id: 'idp_new',
    })
  ),
  credentialsSpy: vi.fn(async (_args: { data: { id: string; clientSecret: string } }) => ({
    success: true,
  })),
  navigateSpy: vi.fn(async () => undefined),
}))

vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ baseUrl: 'https://app.example.com' }),
  useNavigate: () => navigateSpy,
  Link: ({
    children,
    to,
    search: _search,
    ...rest
  }: {
    children: React.ReactNode
    to: string
    search?: unknown
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/server/functions/sso', () => ({
  upsertIdentityProviderFn: upsertSpy,
  setProviderCredentialsFn: credentialsSpy,
  fetchDiscoveryScopesFn: vi.fn(async () => ({ scopes: [] })),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ProviderCreatePage />
    </QueryClientProvider>
  )
}

const saveAndTest = () => fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
const lastUpsert = () => upsertSpy.mock.calls.at(-1)![0].data
const lastNavigate = () =>
  (
    navigateSpy.mock.calls.at(-1) as unknown as [{ to: string; params: unknown; search: unknown }]
  )[0]

beforeEach(() => {
  upsertSpy.mockClear()
  credentialsSpy.mockClear()
  navigateSpy.mockClear()
})

describe('<ProviderCreatePage>', () => {
  it('presents the redirect URI before the credentials it produces', () => {
    renderPage()
    const uri = screen.getByText(/\/api\/auth\/oauth2\/callback\/oidc_/)
    const clientId = screen.getByLabelText('Client ID')
    // Node.compareDocumentPosition: FOLLOWING (4) means clientId comes after.
    expect(uri.compareDocumentPosition(clientId) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows only connection inputs: nothing that needs a saved provider', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Connect single sign-on' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Add domain')).toBeNull()
    expect(screen.queryByRole('button', { name: /test sign-in/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull()
    expect(screen.queryByLabelText(/without an email/i)).toBeNull()
    expect(screen.queryByLabelText('New account role')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('keeps scopes, prompt, client auth and display name behind Connection options', () => {
    renderPage()
    expect(screen.queryByLabelText('Display name')).toBeNull()
    expect(screen.queryByText('Scopes')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Connection options/ }))
    expect(screen.getByLabelText('Display name')).toBeInTheDocument()
    expect(screen.getByText('Scopes')).toBeInTheDocument()
    expect(screen.getByText('Sign-in prompt')).toBeInTheDocument()
    expect(screen.getByText('Client authentication')).toBeInTheDocument()
  })

  it('refuses to save without a client ID and focuses the field', async () => {
    renderPage()
    saveAndTest()
    await waitFor(() => expect(screen.getByLabelText('Client ID')).toHaveFocus())
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('prefills the display name from the selected provider', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-123')
    fireEvent.click(screen.getByRole('radio', { name: 'Okta' }))
    saveAndTest()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert()).toMatchObject({ label: 'Okta', kind: 'okta' })
  })

  it('lets Connection options override the display name', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-123')
    fireEvent.click(screen.getByRole('button', { name: /Connection options/ }))
    await userEvent.clear(screen.getByLabelText('Display name'))
    await userEvent.type(screen.getByLabelText('Display name'), 'Acme SSO')
    saveAndTest()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().label).toBe('Acme SSO')
  })

  it('uses the registrationId the route generated so SSR and hydration show one redirect URI', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <ProviderCreatePage registrationId="oidc_fromroute" />
      </QueryClientProvider>
    )
    expect(screen.getByText(/\/api\/auth\/oauth2\/callback\/oidc_fromroute$/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-123')
    saveAndTest()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().registrationId).toBe('oidc_fromroute')
  })

  it('saves under a generated oidc_ registrationId and opens the detail page with the test', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-123')
    await userEvent.type(screen.getByLabelText('Client secret'), 's3cret')
    saveAndTest()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().registrationId).toMatch(/^oidc_[a-z0-9]+$/)
    expect(lastUpsert()).toMatchObject({ clientId: 'client-123' })
    await waitFor(() =>
      expect(credentialsSpy).toHaveBeenCalledWith({
        data: { id: 'idp_new', clientSecret: 's3cret' },
      })
    )
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled())
    expect(lastNavigate()).toMatchObject({
      to: '/admin/settings/security/sso/$providerId',
      params: { providerId: 'idp_new' },
      search: { test: true },
    })
  })

  it('does not ask for a test when no secret was saved', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-123')
    saveAndTest()
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled())
    expect(credentialsSpy).not.toHaveBeenCalled()
    expect(lastNavigate().search).toEqual({})
  })

  it('lands on the page without a test when the secret failed to save', async () => {
    credentialsSpy.mockRejectedValueOnce(new Error('nope'))
    renderPage()
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-123')
    await userEvent.type(screen.getByLabelText('Client secret'), 's3cret')
    saveAndTest()
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled())
    expect(lastNavigate().search).toEqual({})
  })

  it('seeds the canonical discovery URL for a fixed-discovery family', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-123')
    fireEvent.click(screen.getByRole('radio', { name: 'Google Workspace' }))
    saveAndTest()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    const sent = lastUpsert() as { discoveryUrl?: string | null; kind?: string; label?: string }
    expect(sent.discoveryUrl).toContain('accounts.google.com')
    // Kind and URL are applied in one update; the URL must not clobber the kind.
    expect(sent.kind).toBe('google')
    expect(sent.label).toBe('Google Workspace')
  })
})
