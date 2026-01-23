import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { getSetupState, isOnboardingComplete } from '@quackback/db/types'
import { getCurrentUserRole } from '@/lib/server-functions/workspace'
import { fetchUserAvatar } from '@/lib/server-functions/portal'
import { PortalHeader } from '@/components/public/portal-header'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/settings'
import { theme } from '@/lib/theme'

export const Route = createFileRoute('/_portal')({
  loader: async ({ context }) => {
    const { session, settingsData } = context

    const org = settingsData?.settings ?? context.settings
    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    // Redirect to onboarding if setup is incomplete
    const setupState = getSetupState(org.setupState)
    console.log(
      `[_portal] setupState=${JSON.stringify(setupState)}, isComplete=${isOnboardingComplete(setupState)}`
    )
    if (!isOnboardingComplete(setupState)) {
      console.log(`[_portal] Redirecting to /onboarding - setup incomplete`)
      throw redirect({ to: '/onboarding' })
    }

    const [userRole, avatarData] = await Promise.all([
      getCurrentUserRole(),
      session?.user
        ? fetchUserAvatar({
            data: { userId: session.user.id, fallbackImageUrl: session.user.image },
          })
        : null,
    ])

    const brandingData = settingsData?.brandingData ?? null
    const faviconData = settingsData?.faviconData ?? null
    const brandingConfig = settingsData?.brandingConfig ?? {}
    const portalConfig = settingsData?.publicPortalConfig ?? null

    const hasThemeConfig = brandingConfig.preset || brandingConfig.light || brandingConfig.dark
    const themeStyles = hasThemeConfig ? theme.generateThemeCSS(brandingConfig) : ''
    const googleFontsUrl = theme.getGoogleFontsUrl(brandingConfig)

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
      oidc: portalConfig?.oidc ?? null,
    }

    return {
      org,
      userRole,
      session,
      brandingData,
      faviconData,
      themeStyles,
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
  const { org, userRole, brandingData, themeStyles, googleFontsUrl, initialUserData, authConfig } =
    Route.useLoaderData()

  return (
    <AuthPopoverProvider>
      <div className="min-h-screen bg-background flex flex-col">
        {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
        {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
        <PortalHeader
          orgName={org.name}
          orgLogo={brandingData?.logoUrl ?? null}
          userRole={userRole}
          initialUserData={initialUserData}
        />
        <main className="mx-auto max-w-6xl w-full flex-1 px-4 sm:px-6">
          <Outlet />
        </main>
        <AuthDialog authConfig={authConfig} orgSlug={org.slug} />
      </div>
    </AuthPopoverProvider>
  )
}
