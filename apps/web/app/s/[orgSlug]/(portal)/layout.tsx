import { getOrganizationBySlug, getCurrentUserRoleBySlug } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { PortalHeader } from '@/components/public/portal-header'
import { getUserAvatarData } from '@/lib/avatar'
import { getOrganizationLogoData } from '@/lib/organization'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { SessionProvider } from '@/components/providers/session-provider'
import { organizationService, DEFAULT_PORTAL_CONFIG } from '@quackback/domain'
import { theme } from '@quackback/domain'

// Force dynamic rendering since we read session cookies
export const dynamic = 'force-dynamic'

/**
 * Public portal layout - no auth required
 * Provides org branding and navigation
 */
export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params

  const [org, userRole, session] = await Promise.all([
    getOrganizationBySlug(orgSlug),
    getCurrentUserRoleBySlug(orgSlug),
    getSession(),
  ])

  // Org validation is done in parent tenant layout
  if (!org) {
    return null
  }

  // Get avatar URL with base64 data for SSR (no flicker)
  // Get logo URL from blob storage for SSR
  // Get portal config for branding and auth
  const [avatarData, logoData, brandingResult, portalResult] = await Promise.all([
    session?.user ? getUserAvatarData(session.user.id, session.user.image) : null,
    getOrganizationLogoData(org.id),
    organizationService.getBrandingConfig(org.id),
    organizationService.getPublicPortalConfig(orgSlug),
  ])

  // Generate theme CSS from org config
  const brandingConfig = brandingResult.success ? brandingResult.value : {}
  const themeStyles =
    brandingConfig.preset || brandingConfig.light || brandingConfig.dark
      ? theme.generateThemeCSS(brandingConfig)
      : ''

  // Build initial user data for SSR (used by both header props and provider)
  const initialUserData = session?.user
    ? {
        name: session.user.name,
        email: session.user.email,
        avatarUrl: avatarData?.avatarUrl ?? null,
      }
    : undefined

  // Build auth config for the auth dialog
  const portalConfig = portalResult.success ? portalResult.value : DEFAULT_PORTAL_CONFIG
  const authConfig = {
    found: true,
    oauth: portalConfig.oauth,
  }

  // Get APP_DOMAIN for OAuth URLs (passed to client components)
  const appDomain = process.env.APP_DOMAIN || 'localhost:3000'

  const content = (
    <div className="min-h-screen bg-background flex flex-col">
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      <PortalHeader
        orgName={org.name}
        orgLogo={logoData.logoUrl}
        userRole={userRole}
        initialUserData={initialUserData}
      />
      <main className="mx-auto max-w-5xl w-full flex-1">{children}</main>
      {/* Auth dialog for inline authentication */}
      <AuthDialog authConfig={authConfig} appDomain={appDomain} orgSlug={orgSlug} />
    </div>
  )

  // Wrap with providers:
  // - SessionProvider hydrates better-auth session from SSR data (prevents flash)
  // - AuthPopoverProvider manages auth dialog state
  return (
    <SessionProvider initialSession={session}>
      <AuthPopoverProvider>{content}</AuthPopoverProvider>
    </SessionProvider>
  )
}
