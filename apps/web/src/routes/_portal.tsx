import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
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
    const portalConfig = settings?.publicPortalConfig ?? null

    const hasThemeConfig = brandingConfig.preset || brandingConfig.light || brandingConfig.dark
    const themeStyles = hasThemeConfig ? generateThemeCSS(brandingConfig) : ''
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
