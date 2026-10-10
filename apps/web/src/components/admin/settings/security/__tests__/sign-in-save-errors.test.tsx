// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SignInProvidersTab } from '../sign-in-providers-tab'
import { updateAuthConfigFn } from '@/lib/server/functions/settings'
import { createAutosaveMutationCache } from '@/lib/client/autosave'
import type { AuthConfig } from '@/lib/shared/types/settings'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: () => ({ managedFieldPaths: [] }),
}))
vi.mock('@/lib/server/functions/settings', () => ({
  updateAuthConfigFn: vi.fn(),
  updatePortalConfigFn: vi.fn(),
}))
vi.mock('@/components/admin/settings/security/identity-providers/provider-list', () => ({
  IdentityProvidersSection: () => <div />,
}))
vi.mock('@/components/admin/settings/auth-shared/oauth-provider-grid', () => ({
  OAuthProviderGrid: () => <div />,
}))

const teamAuth: AuthConfig = {
  oauth: { password: true, magicLink: true, google: false, github: false },
  openSignup: false,
}

beforeEach(() => vi.clearAllMocks())

describe('sign-in save failures', () => {
  it('names the server reason an admin can act on', async () => {
    vi.mocked(updateAuthConfigFn).mockRejectedValue(
      new Error('Keep at least one sign-in method enabled.')
    )
    const qc = new QueryClient({ mutationCache: createAutosaveMutationCache() })
    qc.setQueryData(['settings', 'identityProviders'], [])
    render(
      <QueryClientProvider client={qc}>
        <SignInProvidersTab
          initialTeamAuthConfig={teamAuth}
          credentialStatus={{ _emailConfigured: true }}
          customOidcProviderTier={false}
        />
      </QueryClientProvider>
    )
    fireEvent.click(screen.getAllByRole('switch')[0])
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't save. Keep at least one sign-in method enabled."
    )
  })
})
