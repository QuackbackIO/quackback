import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { ThemeProvider } from 'next-themes'
import { fetchUserAvatar } from '@/lib/server/functions/portal'
import { PortalHeader } from '@/components/public/portal-header'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings'
import { generateThemeCSS, getGoogleFontsUrl } from '@/lib/shared/theme'

export const Route = createFileRoute('/_portal')({
  loader: async ({ context }) => {
    const { session, settings, userRole } = context

    const org = settings?.settings
    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    // userRole comes from bootstrap data, avatar needs to be fetched
    const avatarData = session?.user
      ? await fetchUserAvatar({
          data: { userId: session.user.id, fallbackImageUrl: session.user.image },
        })
      : null

    const brandingData = settings?.brandingData ?? null
    const faviconData = settings?.faviconData ?? null
    const brandingConfig = settings?.brandingConfig ?? {}
    const customCss = settings?.customCss ?? ''
    const portalConfig = settings?.publicPortalConfig ?? null

    // Determine branding mode (default to 'simple' for backwards compatibility)
    const brandingMode = brandingConfig.brandingMode ?? 'simple'

    // Determine theme mode (default to 'user' for backwards compatibility)
    const themeMode = brandingConfig.themeMode ?? 'user'

    // Apply CSS based on branding mode - only one or the other, never both
    const hasThemeConfig = brandingConfig.preset || brandingConfig.light || brandingConfig.dark
    const themeStyles =
      brandingMode === 'simple' && hasThemeConfig ? generateThemeCSS(brandingConfig) : ''
    const customCssToApply = brandingMode === 'advanced' ? customCss : ''

    // Font loading only in simple mode (advanced mode handles its own fonts)
    const googleFontsUrl = brandingMode === 'simple' ? getGoogleFontsUrl(brandingConfig) : null

    const initialUserData = session?.user
      ? {
          name: session.user.name,
          email: session.user.email,
          avatarUrl: avatarData?.avatarUrl ?? null,
        }
      : undefined

    const authConfig = {
      found: true,
      oauth: portalConfig?.oauth ?? DEFAULT_PORTAL_CONFIG.oauth,
    }

    return {
      org,
      userRole,
      session,
      brandingData,
      faviconData,
      themeStyles,
      customCss: customCssToApply,
      themeMode,
      googleFontsUrl,
      initialUserData,
      authConfig,
    }
  },
  head: ({ loaderData }) => {
    // Favicon priority: dedicated favicon > workspace logo > default logo.png
    const faviconUrl =
      loaderData?.faviconData?.url || loaderData?.brandingData?.logoUrl || '/logo.png'

    return {
      meta: [{ title: loaderData?.org?.name }],
      links: [{ rel: 'icon', href: faviconUrl }],
    }
  },
  component: PortalLayout,
})

function PortalLayout() {
  const {
    org,
    userRole,
    brandingData,
    themeStyles,
    customCss,
    themeMode,
    googleFontsUrl,
    initialUserData,
    authConfig,
  } = Route.useLoaderData()

  // When theme is forced (not 'user'), we use forcedTheme prop to prevent
  // next-themes from reading/writing localStorage or respecting system preference
  const forcedTheme = themeMode !== 'user' ? themeMode : undefined

  const content = (
    <div className="min-h-screen bg-background flex flex-col">
      {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      {/* Custom CSS is injected after theme styles so it can override */}
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
      <PortalHeader
        orgName={org.name}
        orgLogo={brandingData?.logoUrl ?? null}
        userRole={userRole}
        initialUserData={initialUserData}
        showThemeToggle={themeMode === 'user'}
      />
      <main className="mx-auto max-w-6xl w-full flex-1 px-4 sm:px-6">
        <Outlet />
      </main>
      <AuthDialog authConfig={authConfig} />
    </div>
  )

  return (
    <AuthPopoverProvider>
      {forcedTheme ? (
        <>
          {/* Inline script sets theme class immediately to prevent flash during hydration */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){var d=document.documentElement,c=d.classList;c.remove('light','dark','system');c.add('${forcedTheme}');d.style.colorScheme='${forcedTheme}'})()`,
            }}
          />
          {/* Nested ThemeProvider with forcedTheme keeps theme locked after hydration */}
          <ThemeProvider
            attribute="class"
            forcedTheme={forcedTheme}
            disableTransitionOnChange
            storageKey="portal-theme-forced"
          >
            {content}
          </ThemeProvider>
        </>
      ) : (
        content
      )}
    </AuthPopoverProvider>
  )
}
