import { useNavigate } from '@tanstack/react-router'
import { ArrowRightOnRectangleIcon, GlobeAltIcon } from '@heroicons/react/24/solid'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PortalAuthTab } from './portal-auth-tab'
import { SignInProvidersTab } from './sign-in-providers-tab'
import type { AuthConfig, PortalAuthMethods, PortalConfig } from '@/lib/shared/types/settings'

/**
 * The Security/authentication page tabs split by concern, not by surface:
 *  - `portal-access` — who can view the portal (visibility, domains, invites, segments, widget)
 *  - `sign-in`       — authentication providers for both surfaces in one place
 *                       (password + 2FA enforcement, magic link, social, custom OIDC)
 *                       with per-surface toggles inline.
 */
export type AuthTab = 'portal-access' | 'sign-in'

interface AuthSettingsProps {
  /** Current selected tab. URL-driven via `?tab=` so the choice is
   *  bookmarkable and the back button switches back. */
  tab: AuthTab
  /** Team-side auth config from settings.authConfig. */
  teamAuthConfig: AuthConfig
  /** Portal-side oauth/methods from settings.portalConfig.oauth. */
  portalOauth: PortalAuthMethods
  /** Full portal config — needed for the visibility card inside PortalAuthTab. */
  portalConfig: PortalConfig
  credentialStatus: Record<string, boolean> & { _emailConfigured?: boolean }
  /** Tier flag for portal custom OIDC — passed through to <SignInProvidersTab>. */
  customOidcProviderTier: boolean
}

/**
 * Unified Authentication settings page.
 *
 * Two concern-scoped tabs sit on top of the same provider catalog and
 * `platform_credentials` rows. Selecting a tab shows the cards for that
 * concern; surface scope is communicated within the cards themselves
 * (e.g. per-surface toggles on the Sign-in tab).
 */
export function AuthSettings({
  tab,
  teamAuthConfig,
  portalOauth,
  portalConfig,
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
        // Callback form preserves any other search params on the URL;
        // a literal `{ tab }` would silently strip them, breaking any
        // future deep-link that adds a sibling param like `?highlight=`.
        const nextTab = next as AuthTab
        void navigate({
          to: '/admin/settings/security/authentication',
          search: (prev) => ({ ...prev, tab: nextTab }),
          replace: true,
        })
      }}
      className="space-y-6"
    >
      <TabsList>
        <TabsTrigger value="portal-access">
          <GlobeAltIcon />
          Portal access
        </TabsTrigger>
        <TabsTrigger value="sign-in">
          <ArrowRightOnRectangleIcon />
          Sign-in
        </TabsTrigger>
      </TabsList>

      <TabsContent value="portal-access">
        <PortalAuthTab portalConfig={portalConfig} />
      </TabsContent>

      <TabsContent value="sign-in">
        <SignInProvidersTab
          initialTeamAuthConfig={teamAuthConfig}
          initialPortalOauth={portalOauth}
          portalConfig={portalConfig}
          credentialStatus={credentialStatus}
          customOidcProviderTier={customOidcProviderTier}
        />
      </TabsContent>
    </Tabs>
  )
}
