import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { getCurrentUserRole } from '@/lib/server-functions/workspace'
import { fetchUserAvatar } from '@/lib/server-functions/portal'
import { PortalHeader } from '@/components/public/portal-header'
import {
  fetchSettingsBrandingData,
  fetchSettingsFaviconData,
} from '@/lib/server-functions/settings-utils'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { fetchBrandingConfig, fetchPublicPortalConfig } from '@/lib/server-functions/settings'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/settings'
import { theme } from '@/lib/theme'

export const Route = createFileRoute('/_portal')({
  loader: async ({ context }) => {
    console.log('[_portal] loader started', { context })
    const { session, settings: org } = context

    if (!org) {
      console.log('[_portal] no org, redirecting to onboarding')
      throw redirect({ to: '/onboarding' })
    }

    const userRole = await getCurrentUserRole()

    const [avatarData, brandingData, faviconData, brandingConfig, portalConfig] = await Promise.all(
      [
        session?.user
          ? fetchUserAvatar({
              data: { userId: session.user.id, fallbackImageUrl: session.user.image },
            })
          : null,
        fetchSettingsBrandingData(),
        fetchSettingsFaviconData(),
        fetchBrandingConfig(),
        fetchPublicPortalConfig(),
      ]
    )

    const themeStyles =
      brandingConfig.preset || brandingConfig.light || brandingConfig.dark
        ? theme.generateThemeCSS(brandingConfig)
        : ''

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
    }

    console.log('[_portal] loader completed', { org, userRole, session: !!session })
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
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.org?.name }],
    links: loaderData?.faviconData?.url
      ? [{ rel: 'icon', href: loaderData.faviconData.url }]
      : undefined,
  }),
  component: PortalLayout,
})

function PortalLayout() {
  console.log('[_portal] PortalLayout render')
  const { org, userRole, brandingData, themeStyles, googleFontsUrl, initialUserData, authConfig } =
    Route.useLoaderData()

  const content = (
    <div className="min-h-screen bg-background flex flex-col">
      {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      <PortalHeader
        orgName={org.name}
        orgLogo={brandingData?.logoUrl ?? null}
        userRole={userRole}
        initialUserData={initialUserData}
      />
      <main className="mx-auto max-w-5xl w-full flex-1">
        <Outlet />
      </main>
      <AuthDialog authConfig={authConfig} orgSlug={org.slug} />
    </div>
  )

  return <AuthPopoverProvider>{content}</AuthPopoverProvider>
}
