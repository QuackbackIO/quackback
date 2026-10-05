// @vitest-environment happy-dom
/**
 * The "Email magic link" row explains how to enable it when no email
 * provider is configured. It must name every supported sending provider.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SignInProvidersTab } from '../sign-in-providers-tab'
import type { AuthConfig } from '@/lib/shared/types/settings'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: () => ({ managedFieldPaths: [] }),
}))

vi.mock('@/lib/server/functions/settings', () => ({
  updateAuthConfigFn: vi.fn(),
  updatePortalConfigFn: vi.fn(),
}))

vi.mock('@/components/admin/settings/security/identity-providers/provider-list', () => ({
  IdentityProvidersSection: () => <div data-testid="identity-providers-section" />,
}))

vi.mock('@/components/admin/settings/auth-shared/oauth-provider-grid', () => ({
  OAuthProviderGrid: () => <div data-testid="oauth-provider-grid" />,
}))

const teamAuth: AuthConfig = {
  oauth: { password: true, magicLink: false },
  openSignup: false,
}

function renderTab(emailConfigured: boolean) {
  const qc = new QueryClient()
  qc.setQueryData(['settings', 'identityProviders'], [])
  return render(
    <QueryClientProvider client={qc}>
      <SignInProvidersTab
        initialTeamAuthConfig={teamAuth}
        credentialStatus={{ _emailConfigured: emailConfigured }}
        customOidcProviderTier={false}
      />
    </QueryClientProvider>
  )
}

describe('Email magic link hint', () => {
  it('names SMTP, Amazon SES and Resend when email is not configured', () => {
    renderTab(false)
    expect(
      screen.getByText('Configure SMTP, Amazon SES or Resend to enable email delivery.')
    ).toBeInTheDocument()
  })

  it('describes the method when email is configured', () => {
    renderTab(true)
    expect(screen.getByText('One-click link or 6-digit code by email.')).toBeInTheDocument()
  })
})
