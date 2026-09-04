// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AuthConfig, PortalConfig } from '@/lib/shared/types/settings'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

vi.mock('../portal-auth-tab', () => ({
  PortalAuthTab: () => <div>portal-access-body</div>,
}))
vi.mock('../sign-in-providers-tab', () => ({
  SignInProvidersTab: () => <div>sign-in-body</div>,
}))
vi.mock('../audit-log-page', () => ({
  AuditLogPage: () => <div>audit-feed</div>,
}))
vi.mock('@/components/admin/upgrade', () => ({
  UpgradeScreen: () => <div>The audit log is an Enterprise feature</div>,
}))

const { AuthSettings } = await import('../auth-settings')

const TEAM_AUTH = { openSignup: false } as AuthConfig
const PORTAL = {} as PortalConfig

describe('AuthSettings audit tab', () => {
  it('keeps portal access when the audit log is not on the plan', () => {
    render(
      <AuthSettings
        tab="portal-access"
        teamAuthConfig={TEAM_AUTH}
        portalConfig={PORTAL}
        credentialStatus={{}}
        customOidcProviderTier={false}
        auditEntitled={false}
      />
    )
    expect(screen.getByText('portal-access-body')).toBeDefined()
    expect(screen.queryByText('audit-feed')).toBeNull()
    expect(screen.queryByText(/The audit log is an Enterprise feature/)).toBeNull()
  })

  it('shows an upgrade notice on the audit tab instead of the feed', () => {
    render(
      <AuthSettings
        tab="audit-log"
        teamAuthConfig={TEAM_AUTH}
        portalConfig={PORTAL}
        credentialStatus={{}}
        customOidcProviderTier={false}
        auditEntitled={false}
      />
    )
    expect(screen.getByText(/The audit log is an Enterprise feature/)).toBeDefined()
    expect(screen.queryByText('audit-feed')).toBeNull()
  })

  it('renders the feed when the plan includes the audit log', () => {
    render(
      <AuthSettings
        tab="audit-log"
        teamAuthConfig={TEAM_AUTH}
        portalConfig={PORTAL}
        credentialStatus={{}}
        customOidcProviderTier
        auditEntitled
      />
    )
    expect(screen.getByText('audit-feed')).toBeDefined()
    expect(screen.queryByText(/The audit log is an Enterprise feature/)).toBeNull()
  })

  it('keeps the audit tab reachable so the upgrade is discoverable', () => {
    render(
      <AuthSettings
        tab="sign-in"
        teamAuthConfig={TEAM_AUTH}
        portalConfig={PORTAL}
        credentialStatus={{}}
        customOidcProviderTier={false}
        auditEntitled={false}
      />
    )
    expect(screen.getByRole('tab', { name: /Audit log/i })).toBeDefined()
  })
})
