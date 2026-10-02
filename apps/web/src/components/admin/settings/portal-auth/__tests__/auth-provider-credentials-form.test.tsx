// @vitest-environment happy-dom
import { Suspense } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const fns = vi.hoisted(() => ({ fetchMasked: vi.fn(), save: vi.fn(), remove: vi.fn() }))

vi.mock('@/lib/server/functions/auth-provider-credentials', () => ({
  saveAuthProviderCredentialsFn: fns.save,
  deleteAuthProviderCredentialsFn: fns.remove,
  fetchAuthProviderCredentialsMaskedFn: fns.fetchMasked,
}))

const { AuthProviderCredentialsForm } = await import('../auth-provider-credentials-form')

const FIELDS = [
  { key: 'clientId', label: 'Client ID', sensitive: false },
  { key: 'clientSecret', label: 'Client secret', sensitive: true },
]

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>
        <AuthProviderCredentialsForm
          credentialType="auth_github"
          providerId="github"
          providerName="GitHub"
          fields={FIELDS}
        />
      </Suspense>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  fns.fetchMasked.mockResolvedValue({
    configured: true,
    fields: { clientId: 'abc***', clientSecret: '***' },
    baseUrl: 'https://app.example.com',
  })
  fns.remove.mockResolvedValue({})
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AuthProviderCredentialsForm remove', () => {
  it('asks before removing and removes only on confirm', async () => {
    renderForm()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(fns.remove).not.toHaveBeenCalled()
    expect(await screen.findByText('Remove GitHub credentials?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove credentials' }))
    await waitFor(() => expect(fns.remove).toHaveBeenCalledTimes(1))
    expect(fns.remove).toHaveBeenCalledWith({ data: { credentialType: 'auth_github' } })
  })

  it('keeps the credentials when the confirmation is cancelled', async () => {
    renderForm()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fns.remove).not.toHaveBeenCalled()
  })
})
