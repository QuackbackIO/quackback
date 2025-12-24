import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSettings, getCurrentUserRole } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { PortalHeader } from '@/components/public/portal-header'
import { getUserAvatarData } from '@/lib/avatar'
import { getWorkspaceBrandingData, getWorkspaceFaviconData } from '@/lib/settings-utils'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { SessionProvider } from '@/components/providers/session-provider'
import { workspaceService, DEFAULT_PORTAL_CONFIG } from '@quackback/domain'
import { theme } from '@quackback/domain'

// Force dynamic rendering since we read session cookies
export const dynamic = 'force-dynamic'

/**
 * Generate dynamic metadata for the portal including custom favicon.
 */
export async function generateMetadata(): Promise<Metadata> {
  // Workspace is validated in root layout
  const org = await getSettings()

  if (!org) {
    return {}
  }

  const faviconData = await getWorkspaceFaviconData()

  // Build icons metadata - use custom favicon or fallback to Quackback logo
  const icons: Metadata['icons'] = {
    icon: faviconData?.url ?? '/favicon.ico',
  }

  return {
    title: org.name,
    icons,
  }
}

/**
 * Public portal layout - no auth required
 * Provides org branding and navigation
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // Workspace is validated in root layout

  const [org, userRole, session] = await Promise.all([
    getSettings(),
    getCurrentUserRole(),
    getSession(),
  ])

  // Redirect to onboarding if no settings exist (fresh install)
  if (!org) {
    redirect('/onboarding')
  }

  // Get avatar URL with base64 data for SSR (no flicker)
  // Get branding data (logo) from blob storage for SSR
  // Get portal config for branding and auth
  // Get custom CSS for portal customization
  const [avatarData, brandingData, brandingResult, portalResult, customCssResult] =
    await Promise.all([
      session?.user ? getUserAvatarData(session.user.id, session.user.image) : null,
      getWorkspaceBrandingData(),
      workspaceService.getBrandingConfig(),
      workspaceService.getPublicPortalConfig(),
      workspaceService.getCustomCss(),
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
        orgLogo={brandingData?.logoUrl ?? null}
        headerLogo={brandingData?.headerLogoUrl ?? null}
        headerDisplayMode={
          (brandingData?.headerDisplayMode as 'logo_and_name' | 'logo_only' | 'custom_logo') ??
          undefined
        }
        headerDisplayName={brandingData?.headerDisplayName ?? null}
        userRole={userRole}
        initialUserData={initialUserData}
      />
      <main className="mx-auto max-w-5xl w-full flex-1">{children}</main>
      {/* Auth dialog for inline authentication */}
      <AuthDialog authConfig={authConfig} orgSlug={org.slug} />
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
