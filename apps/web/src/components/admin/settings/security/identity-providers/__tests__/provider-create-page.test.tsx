// @vitest-environment happy-dom
/**
 * <ProviderCreatePage> — the deliberately short half of the split.
 *
 * Two things are load-bearing here. The redirect URI must precede the
 * credential fields, because it is the input to the IdP registration that
 * produces them; presenting it afterwards is how `redirect_uri_mismatch` gets
 * discovered on the first real sign-in instead of during setup. And nothing
 * that needs a saved provider — domains, enforcement, the connection test,
 * claim mapping — may appear before the row exists.
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

beforeEach(() => {
  upsertSpy.mockClear()
  credentialsSpy.mockClear()
  navigateSpy.mockClear()
})

describe('<ProviderCreatePage>', () => {
  it('presents the redirect URI before the credentials it produces', () => {
    const { container } = renderPage()
    const uri = screen.getByText(/\/api\/auth\/oauth2\/callback\/oidc_/)
    const clientId = screen.getByLabelText('Client ID')
    // Node.compareDocumentPosition: FOLLOWING (4) means clientId comes after.
    expect(uri.compareDocumentPosition(clientId) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container).toBeTruthy()
  })

  it('shows nothing that needs a saved provider', () => {
    renderPage()
    expect(screen.queryByLabelText('Add domain')).toBeNull()
    expect(screen.queryByRole('button', { name: /test sign-in/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Map roles from claims/ })).toBeNull()
    expect(screen.queryByLabelText(/allow accounts without an email/i)).toBeNull()
    expect(screen.queryByLabelText('Default role')).toBeNull()
  })

  it('refuses to create without a display name and focuses the field', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Create provider' }))
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveFocus())
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('refuses to create without a client ID and focuses the field', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Display name'), 'Acme SSO')
    fireEvent.click(screen.getByRole('button', { name: 'Create provider' }))
    await waitFor(() => expect(screen.getByLabelText('Client ID')).toHaveFocus())
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('creates the provider under a generated oidc_ registrationId and opens its page', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Display name'), 'Acme SSO')
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-123')
    fireEvent.click(screen.getByRole('button', { name: 'Create provider' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    const sent = upsertSpy.mock.calls.at(-1)![0].data
    expect(sent.registrationId).toMatch(/^oidc_[a-z0-9]+$/)
    expect(sent).toMatchObject({ label: 'Acme SSO', clientId: 'client-123' })
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: '/admin/settings/security/sso/$providerId',
        params: { providerId: 'idp_new' },
      })
    )
  })

  it('saves a typed client secret against the new row', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Display name'), 'Acme SSO')
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-123')
    await userEvent.type(screen.getByLabelText('Client secret'), 's3cret')
    fireEvent.click(screen.getByRole('button', { name: 'Create provider' }))
    await waitFor(() =>
      expect(credentialsSpy).toHaveBeenCalledWith({
        data: { id: 'idp_new', clientSecret: 's3cret' },
      })
    )
  })

  it('skips the credential call when no secret was typed', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Display name'), 'Acme SSO')
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-123')
    fireEvent.click(screen.getByRole('button', { name: 'Create provider' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(credentialsSpy).not.toHaveBeenCalled()
  })

  it('seeds the canonical discovery URL for a fixed-discovery family', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Display name'), 'Google')
    await userEvent.type(screen.getByLabelText('Client ID'), 'client-123')
    fireEvent.click(screen.getByRole('radio', { name: 'Google Workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create provider' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    const sent = upsertSpy.mock.calls.at(-1)![0].data as { discoveryUrl?: string | null }
    expect(sent.discoveryUrl).toContain('accounts.google.com')
  })
})
