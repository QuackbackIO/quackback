import { Link } from '@tanstack/react-router'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import type { AuthConfig, VerifiedDomain } from '@/lib/shared/types/settings'

interface SsoPageCalloutProps {
  authConfig: AuthConfig
  verifiedDomains: VerifiedDomain[]
}

/**
 * Card surfaced on the team auth methods tab linking admins to the /sso
 * page. Always visible — copy adapts: "Set up SSO →" before first
 * configuration, "Manage SSO →" once the tenant has touched SSO.
 */
export function SsoPageCallout({ authConfig, verifiedDomains }: SsoPageCalloutProps) {
  const hasSso = authConfig.ssoOidc?.enabled === true || verifiedDomains.length > 0
  const title = hasSso ? 'Single sign-on is set up' : 'Connect single sign-on'
  const description = hasSso
    ? 'Manage your IdP, verified domains, attribute mapping, and recovery codes on the SSO page.'
    : 'Set up SSO with Okta, Auth0, Microsoft Entra, Google Workspace, Keycloak, or any OpenID Connect IdP.'
  const linkLabel = hasSso ? 'Manage SSO →' : 'Set up SSO →'

  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-4 flex items-start gap-3">
      <ShieldCheckIcon className="size-5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Link
        to="/admin/settings/security/sso"
        className="text-sm font-medium text-primary hover:underline shrink-0"
      >
        {linkLabel}
      </Link>
    </div>
  )
}
