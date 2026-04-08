import { createFileRoute, notFound, redirect, Outlet } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { generateThemeCSS, getGoogleFontsUrl } from '@/lib/shared/theme'
import { resolveLocale } from '@/lib/shared/i18n'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { HelpCenterHeader } from '@/components/help-center/help-center-header'
import { listPublicCategoriesFn } from '@/lib/server/functions/help-center'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'
import type { HelpCenterConfig } from '@/lib/server/domains/settings'

/** Resolve locale from Accept-Language header on the server. */
const getHelpCenterLocale = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const acceptLanguage = getRequestHeaders().get('accept-language')
  return resolveLocale(acceptLanguage)
})

/** Check if the current request has a valid session. */
const checkHasSession = createServerFn({ method: 'GET' }).handler(async () => {
  const { hasSessionCookie } = await import('@/lib/server/functions/auth-helpers')
  if (!hasSessionCookie()) return false
  const { auth } = await import('@/lib/server/auth')
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  return !!session
})

export const Route = createFileRoute('/hc')({
  beforeLoad: async ({ context }) => {
    const { settings } = context

    const flags = settings?.featureFlags as FeatureFlags | undefined
    if (!flags?.helpCenter) throw notFound()

    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    if (!helpCenterConfig?.enabled) throw notFound()

    // Enforce authenticated-only access
    if (helpCenterConfig.access === 'authenticated') {
      const hasSession = await checkHasSession()
      if (!hasSession) {
        throw redirect({ to: '/auth/login', replace: true })
      }
    }
  },
  loader: async ({ context }) => {
    const { settings } = context

    const org = settings?.settings
    if (!org) throw notFound()

    const brandingData = settings?.brandingData ?? null
    const faviconData = settings?.faviconData ?? null
    const brandingConfig = settings?.brandingConfig ?? {}
    const customCss = settings?.customCss ?? ''
    const helpCenterConfig = settings?.helpCenterConfig ?? null

    const themeMode = brandingConfig.themeMode ?? 'user'

    const hasThemeConfig = brandingConfig.light || brandingConfig.dark
    const themeStyles = hasThemeConfig ? generateThemeCSS(brandingConfig) : ''
    const googleFontsUrl = getGoogleFontsUrl(brandingConfig)

    const [categories, locale] = await Promise.all([
      listPublicCategoriesFn({ data: {} }),
      getHelpCenterLocale(),
    ])

    return {
      org,
      brandingData,
      faviconData,
      themeStyles,
      customCss,
      themeMode,
      googleFontsUrl,
      categories,
      helpCenterConfig,
      locale,
    }
  },
  head: ({ loaderData }) => {
    const faviconUrl =
      loaderData?.faviconData?.url || loaderData?.brandingData?.logoUrl || '/logo.png'

    const workspaceName = loaderData?.org?.name ?? 'Help Center'
    const description =
      loaderData?.helpCenterConfig?.homepageDescription ??
      'Search our knowledge base or browse by category'
    const logoUrl = loaderData?.brandingData?.logoUrl || '/logo.png'

    const meta: Array<Record<string, string>> = [
      { title: `${workspaceName} - Help Center` },
      { name: 'description', content: description },
      { property: 'og:site_name', content: workspaceName },
      { property: 'og:title', content: `${workspaceName} - Help Center` },
      { property: 'og:description', content: description },
      { property: 'og:image', content: logoUrl },
      { name: 'twitter:title', content: `${workspaceName} - Help Center` },
      { name: 'twitter:description', content: description },
    ]

    // Prevent search engine indexing for authenticated help centers
    if (loaderData?.helpCenterConfig?.access === 'authenticated') {
      meta.push({ name: 'robots', content: 'noindex, nofollow' })
    }

    return {
      meta,
      links: [{ rel: 'icon', href: faviconUrl }],
    }
  },
  component: HelpCenterLayout,
})

function HelpCenterLayout() {
  const { org, brandingData, themeStyles, customCss, googleFontsUrl, categories, locale } =
    Route.useLoaderData()

  return (
    <PortalIntlProvider locale={locale}>
      <div className="min-h-screen bg-background flex flex-col">
        {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
        {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
        {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
        <HelpCenterHeader
          orgName={org.name}
          orgLogo={brandingData?.logoUrl ?? null}
          categories={categories}
        />
        <main className="mx-auto max-w-6xl w-full flex-1 px-4 sm:px-6">
          <Outlet />
        </main>
      </div>
    </PortalIntlProvider>
  )
}
