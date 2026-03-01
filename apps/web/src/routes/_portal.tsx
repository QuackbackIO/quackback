import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { fetchUserAvatar } from '@/lib/server/functions/portal'
import { PortalHeader } from '@/components/public/portal-header'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings'
import { generateThemeCSS, getGoogleFontsUrl } from '@/lib/shared/theme'

export const Route = createFileRoute('/_portal')({
  loader: async ({ context }) => {
    const { session, settings, userRole, baseUrl } = context

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

    const themeMode = brandingConfig.themeMode ?? 'user'

    // Always generate CSS from theme config (if structured vars exist)
    const hasThemeConfig = brandingConfig.light || brandingConfig.dark
    const themeStyles = hasThemeConfig ? generateThemeCSS(brandingConfig) : ''

    // Always apply custom CSS on top (cascades over theme styles)
    const customCssToApply = customCss

    // Always load Google Fonts from theme config
    const googleFontsUrl = getGoogleFontsUrl(brandingConfig)

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
      customProviderNames: portalConfig?.customProviderNames,
    }

    return {
      org,
      baseUrl: baseUrl ?? '',
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

    const themeMode = loaderData?.themeMode ?? 'user'
    const workspaceName = loaderData?.org?.name ?? 'Quackback'
    const description = `Share feedback, vote on feature requests, and track the ${workspaceName} roadmap.`
    const logoUrl = loaderData?.brandingData?.logoUrl || '/logo.png'

    // Add meta tag for forced theme - read by root's systemThemeScript before hydration
    const meta: Array<Record<string, string>> = [
      { title: workspaceName },
      { name: 'description', content: description },
      { property: 'og:site_name', content: workspaceName },
      { property: 'og:title', content: workspaceName },
      { property: 'og:description', content: description },
      { property: 'og:image', content: logoUrl },
      { name: 'twitter:title', content: workspaceName },
      { name: 'twitter:description', content: description },
    ]
    if (themeMode !== 'user') {
      meta.push({ name: 'theme-forced', content: themeMode })
    }

    return {
      meta,
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

  // Theme enforcement is handled by the root ThemeProvider (in __root.tsx) which
  // reads themeMode from settings and sets forcedTheme on portal routes.
  // The portal only needs to control toggle visibility and inject CSS.

  return (
    <AuthPopoverProvider>
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
    </AuthPopoverProvider>
  )
}
