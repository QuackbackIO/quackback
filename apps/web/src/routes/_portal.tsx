import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { getCurrentUserRole } from '@/lib/workspace'
import { PortalHeader } from '@/components/public/portal-header'
import { getUserAvatarData } from '@/lib/avatar'
import { getWorkspaceBrandingData, getWorkspaceFaviconData } from '@/lib/settings-utils'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { SessionProvider } from '@/components/providers/session-provider'
import {
  getBrandingConfig,
  getPublicPortalConfig,
  getCustomCss,
  DEFAULT_PORTAL_CONFIG,
} from '@/lib/settings'
import { theme } from '@/lib/theme'

/**
 * Public portal layout - no auth required
 * Provides org branding and navigation
 */
export const Route = createFileRoute('/_portal')({
  loader: async ({ context }) => {
    // Session and settings are already available from root context
    const { session, settings: org } = context

    // Redirect to onboarding if no settings exist (fresh install)
    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    const userRole = await getCurrentUserRole()

    // Get avatar URL with base64 data for SSR (no flicker)
    // Get branding data (logo) from blob storage for SSR
    // Get portal config for branding and auth
    // Get custom CSS for portal customization
    const [avatarData, brandingData, faviconData, brandingResult, portalResult, customCssResult] =
      await Promise.all([
        session?.user ? getUserAvatarData(session.user.id, session.user.image) : null,
        getWorkspaceBrandingData(),
        getWorkspaceFaviconData(),
        getBrandingConfig(),
        getPublicPortalConfig(),
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

    return {
      org,
      userRole,
      session,
      brandingData,
      faviconData,
      themeStyles,
      googleFontsUrl,
      customCss,
      initialUserData,
      authConfig,
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.org?.name,
      },
    ],
    links: loaderData?.faviconData?.url
      ? [
          {
            rel: 'icon',
            href: loaderData.faviconData.url,
          },
        ]
      : undefined,
  }),
  component: PortalLayout,
})

function PortalLayout() {
  const {
    org,
    userRole,
    session,
    brandingData,
    themeStyles,
    googleFontsUrl,
    customCss,
    initialUserData,
    authConfig,
  } = Route.useLoaderData()

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
      <main className="mx-auto max-w-5xl w-full flex-1">
        <Outlet />
      </main>
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
