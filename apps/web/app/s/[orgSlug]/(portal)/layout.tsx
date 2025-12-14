import { Metadata } from 'next'
import { getOrganizationBySlug, getCurrentUserRoleBySlug } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { PortalHeader } from '@/components/public/portal-header'
import { getUserAvatarData } from '@/lib/avatar'
import { getOrganizationBrandingData, getOrganizationFaviconData } from '@/lib/organization'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { SessionProvider } from '@/components/providers/session-provider'
import { organizationService, DEFAULT_PORTAL_CONFIG } from '@quackback/domain'
import { theme } from '@quackback/domain'

// Force dynamic rendering since we read session cookies
export const dynamic = 'force-dynamic'

/**
 * Generate dynamic metadata for the portal including custom favicon.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}): Promise<Metadata> {
  const { orgSlug } = await params
  const org = await getOrganizationBySlug(orgSlug)

  if (!org) {
    return {}
  }

  const faviconData = await getOrganizationFaviconData(org.id)

  // Build icons metadata
  const icons: Metadata['icons'] = faviconData.faviconUrl
    ? {
        icon: faviconData.faviconUrl,
      }
    : undefined

  return {
    title: org.name,
    icons,
  }
}

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
  // Get branding data (logo) from blob storage for SSR
  // Get portal config for branding and auth
  // Get custom CSS for portal customization
  const [avatarData, brandingData, brandingResult, portalResult, customCssResult] =
    await Promise.all([
      session?.user ? getUserAvatarData(session.user.id, session.user.image) : null,
      getOrganizationBrandingData(org.id),
      organizationService.getBrandingConfig(org.id),
      organizationService.getPublicPortalConfig(orgSlug),
      organizationService.getCustomCss(org.id),
    ])

  // Generate theme CSS from org config
  const brandingConfig = brandingResult.success ? brandingResult.value : {}
  const themeStyles =
    brandingConfig.preset || brandingConfig.light || brandingConfig.dark
      ? theme.generateThemeCSS(brandingConfig)
      : ''

  // Get Google Fonts URL if using a custom font
  const googleFontsUrl = theme.getGoogleFontsUrl(brandingConfig)

  // Get custom CSS for additional portal styling
  const customCss = customCssResult.success ? customCssResult.value : null

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
      {/* Google Fonts - loaded dynamically based on theme */}
      {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
      {/* Theme CSS variables */}
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      {/* Custom CSS - injected after theme for override capability */}
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
      <PortalHeader
        orgName={org.name}
        orgLogo={brandingData.logoUrl}
        headerLogo={brandingData.headerLogoUrl}
        headerDisplayMode={brandingData.headerDisplayMode}
        headerDisplayName={brandingData.headerDisplayName}
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
