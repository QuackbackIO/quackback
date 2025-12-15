import { requireTenantBySlug, getOrganizationBySlug, getCurrentUserRoleBySlug } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { PortalHeader } from '@/components/public/portal-header'
import { SettingsNav } from './settings-nav'
import { getUserAvatarData } from '@/lib/avatar'
import { getOrganizationBrandingData } from '@/lib/organization'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { SessionProvider } from '@/components/providers/session-provider'
import { organizationService, theme } from '@quackback/domain'

interface SettingsLayoutProps {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}

export default async function SettingsLayout({ children, params }: SettingsLayoutProps) {
  const { orgSlug } = await params

  // Allow ALL authenticated users (team members and portal users)
  const { user } = await requireTenantBySlug(orgSlug)
  const [org, userRole, session] = await Promise.all([
    getOrganizationBySlug(orgSlug),
    getCurrentUserRoleBySlug(orgSlug),
    getSession(),
  ])

  if (!org) {
    return null
  }

  // Get avatar URL with base64 data for SSR (no flicker)
  // Get branding data (logo) from blob storage for SSR
  // Get branding config for theme
  // Get custom CSS for portal customization
  const [avatarData, brandingData, brandingResult, customCssResult] = await Promise.all([
    getUserAvatarData(user.id, user.image),
    getOrganizationBrandingData(org.id),
    organizationService.getBrandingConfig(org.id),
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

  const initialUserData = {
    name: user.name,
    email: user.email,
    avatarUrl: avatarData.avatarUrl,
  }

  return (
    <SessionProvider initialSession={session}>
      <AuthPopoverProvider>
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
          <div className="flex gap-8 px-6 py-8 max-w-5xl mx-auto w-full flex-1">
            <SettingsNav />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </AuthPopoverProvider>
    </SessionProvider>
  )
}
