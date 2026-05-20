import { useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TeamAuthMethodsSection } from './team-auth-methods-section'
import { PortalAuthTab } from './portal-auth-tab'
import { SsoPageCallout } from './sso-page-callout'
import { settingsQueries } from '@/lib/client/queries/settings'
import type { AuthConfig, PortalAuthMethods } from '@/lib/shared/types/settings'

export type AuthTab = 'team' | 'portal'

interface AuthSettingsProps {
  /** Current selected tab. URL-driven via `?tab=` so the choice is
   *  bookmarkable and the back button switches back. */
  tab: AuthTab
  /** Team-side auth config from settings.authConfig. */
  teamAuthConfig: AuthConfig
  /** Portal-side oauth/methods from settings.portalConfig.oauth. */
  portalOauth: PortalAuthMethods
  credentialStatus: Record<string, boolean> & { _emailConfigured?: boolean }
  /** Tier flag for portal custom OIDC — passed through to <PortalAuthTab>. */
  customOidcProviderTier: boolean
}

/**
 * Unified Authentication settings page.
 *
 * Two audience-scoped tabs (Team and Portal) sit on top of the same
 * provider catalog and `platform_credentials` rows. Selecting a tab
 * shows the per-audience methods + per-audience OAuth toggles. SSO
 * configuration has moved to the dedicated /sso page.
 *
 * The selected tab is stored in `?tab=`. Sidebar entries from both
 * "Security" and "End Users" point at the same route with different
 * default tabs, so muscle memory from either nav location lands the
 * admin on the right view.
 */
export function AuthSettings({
  tab,
  teamAuthConfig,
  portalOauth,
  credentialStatus,
  customOidcProviderTier,
}: AuthSettingsProps) {
  // No `from` — passes an absolute `to`, so binding the navigate hook
  // to a route would just append paths under TanStack Router's
  // relative-resolution rules. Same goes for useSearch.
  const navigate = useNavigate()

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        // URL-driven tab state. `replace: true` so the back button
        // doesn't accumulate per-click history entries within the page.
        const nextTab = next as AuthTab
        void navigate({
          to: '/admin/settings/security/authentication',
          search: { tab: nextTab },
          replace: true,
        })
      }}
      className="space-y-6"
    >
      <TabsList className="border-b border-border/50">
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="portal">Portal</TabsTrigger>
      </TabsList>

      <TabsContent value="team" className="space-y-6">
        <TeamAuthMethodsSection initialConfig={teamAuthConfig} />
        <AuthSettingsSsoCallout teamAuthConfig={teamAuthConfig} />
      </TabsContent>

      <TabsContent value="portal">
        <PortalAuthTab
          initialOauth={portalOauth}
          credentialStatus={credentialStatus}
          customOidcProviderTier={customOidcProviderTier}
        />
      </TabsContent>
    </Tabs>
  )
}

function AuthSettingsSsoCallout({ teamAuthConfig }: { teamAuthConfig: AuthConfig }) {
  const verifiedDomainsQuery = useSuspenseQuery(settingsQueries.verifiedDomains())
  return <SsoPageCallout authConfig={teamAuthConfig} verifiedDomains={verifiedDomainsQuery.data} />
}
