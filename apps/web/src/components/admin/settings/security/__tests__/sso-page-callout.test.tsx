// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SsoPageCallout } from '../sso-page-callout'
import type { AuthConfig, VerifiedDomain } from '@/lib/shared/types/settings'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const baseConfig: AuthConfig = { oauth: {}, openSignup: false }
const verifiedDomain: VerifiedDomain = {
  id: 'domain_acme' as `domain_${string}`,
  name: 'acme.com',
  verificationToken: 'tok',
  verifiedAt: '2026-05-01T00:00:00.000Z',
  enforced: false,
  createdAt: '2026-05-01T00:00:00.000Z',
}

describe('<SsoPageCallout>', () => {
  it('renders when ssoOidc.enabled is true', () => {
    render(
      <SsoPageCallout
        authConfig={{
          ...baseConfig,
          ssoOidc: {
            enabled: true,
            discoveryUrl: 'https://idp/.well-known/openid-configuration',
            clientId: 'cid',
            autoCreateUsers: false,
          },
        }}
        verifiedDomains={[]}
      />
    )
    expect(screen.getByText(/single sign-on is set up/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /manage sso/i })).toHaveAttribute(
      'href',
      '/admin/settings/security/sso'
    )
  })

  it('renders when at least one verified domain exists', () => {
    render(<SsoPageCallout authConfig={baseConfig} verifiedDomains={[verifiedDomain]} />)
    expect(screen.getByText(/single sign-on is set up/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /manage sso/i })).toHaveAttribute(
      'href',
      '/admin/settings/security/sso'
    )
  })

  it('renders the setup CTA when SSO is not yet configured', () => {
    render(<SsoPageCallout authConfig={baseConfig} verifiedDomains={[]} />)
    expect(screen.getByText(/connect single sign-on/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /set up sso/i })).toHaveAttribute(
      'href',
      '/admin/settings/security/sso'
    )
  })
})
