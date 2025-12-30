import { createFileRoute, Outlet } from '@tanstack/react-router'
import { requireWorkspace, getCurrentUserRole } from '@/lib/workspace'
import { PortalHeader } from '@/components/public/portal-header'
import { SettingsNav } from '@/app/(portal)/settings/settings-nav'
import { getUserAvatarData } from '@/lib/avatar'
import { getSettingsBrandingData } from '@/lib/settings-utils'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { getBrandingConfig, getCustomCss } from '@/lib/settings'
import { theme } from '@/lib/theme'

export const Route = createFileRoute('/_portal/settings')({
  loader: async ({ context }) => {
    // Session and settings are already available from root context
    const { session, settings } = context

    // Allow ALL authenticated users (team members and portal users)
    const { user } = await requireWorkspace()
    const userRole = await getCurrentUserRole()

    if (!settings) {
      return {
        settings: null,
        userRole: null,
        session: null,
        avatarData: null,
        brandingData: null,
        themeStyles: '',
        googleFontsUrl: null,
        customCss: null,
        initialUserData: undefined,
        user,
      }
    }

    // Get avatar URL with base64 data for SSR (no flicker)
    // Get branding data (logo) from blob storage for SSR
    // Get branding config for theme
    // Get custom CSS for portal customization
    const [avatarData, brandingData, brandingResult, customCssResult] = await Promise.all([
      getUserAvatarData(user.id, user.image),
      getSettingsBrandingData(),
      getBrandingConfig(),
      getCustomCss(),
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
      name: user.name || null,
      email: user.email || null,
      avatarUrl: avatarData.avatarUrl,
    }

    return {
      settings,
      userRole,
      session,
      avatarData,
      brandingData,
      themeStyles,
      googleFontsUrl,
      customCss,
      initialUserData,
      user,
    }
  },
  component: SettingsLayout,
})

function SettingsLayout() {
  const {
    settings,
    userRole,
    brandingData,
    themeStyles,
    googleFontsUrl,
    customCss,
    initialUserData,
  } = Route.useLoaderData()

  if (!settings) {
    return null
  }

  return (
    <AuthPopoverProvider>
      <div className="min-h-screen bg-background flex flex-col">
        {/* Google Fonts - loaded dynamically based on theme */}
        {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
        {/* Theme CSS variables */}
        {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
        {/* Custom CSS - injected after theme for override capability */}
        {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
        <PortalHeader
          orgName={settings.name}
          orgLogo={brandingData?.logoUrl ?? null}
          headerLogo={brandingData?.headerLogoUrl ?? null}
          headerDisplayMode={undefined}
          headerDisplayName={null}
          userRole={userRole}
          initialUserData={initialUserData}
        />
        <div className="flex gap-8 px-6 py-8 max-w-5xl mx-auto w-full flex-1">
          <SettingsNav />
          <main className="min-w-0 flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </AuthPopoverProvider>
  )
}
