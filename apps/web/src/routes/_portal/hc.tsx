import { createFileRoute, notFound, redirect, Outlet, useRouterState } from '@tanstack/react-router'
import { resolveHelpCenterDomainRedirect } from '@/lib/server/domains/help-center/help-center-domain.service'
import { HelpCenterLocaleSwitcher } from '@/components/help-center/help-center-locale-switcher'
import { parseHcLocalePath } from '@/lib/shared/help-center-url'
import { isRtlLocale } from '@/lib/shared/i18n'
import type { FeatureFlags, HelpCenterConfig } from '@/lib/shared/types/settings'

/**
 * Only meaningful during SSR -- request headers aren't available on the
 * client, and a client-side nav that's already on the right host has
 * nothing to redirect. Swallow failures rather than block the page.
 */
async function currentRequestHost(): Promise<string | null> {
  try {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    return getRequestHeaders().get('host')
  } catch {
    return null
  }
}

export const Route = createFileRoute('/_portal/hc')({
  beforeLoad: async ({ context, location }) => {
    const { settings } = context

    const flags = settings?.featureFlags as FeatureFlags | undefined
    if (!flags?.helpCenter) throw notFound()

    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    if (!helpCenterConfig?.enabled) throw notFound()

    // Full-coverage 301: every /hc/* route is nested under this layout, so
    // this is the single place the default-host -> verified-custom-domain
    // redirect needs to live (domains/languages §1).
    const currentHost = await currentRequestHost()
    const target = resolveHelpCenterDomainRedirect({
      domainConfig: helpCenterConfig.domain,
      currentHost,
      pathname: location.pathname,
      // `searchStr` already includes the leading `?` when non-empty.
      search: location.searchStr ?? '',
    })
    if (target) throw redirect({ href: target, statusCode: 301 })
  },
  loader: async ({ context }) => {
    const { settings } = context
    const helpCenterConfig = (settings?.helpCenterConfig as HelpCenterConfig | null) ?? null
    return { helpCenterConfig }
  },
  head: ({ loaderData }) => {
    const indexable = loaderData?.helpCenterConfig?.seo?.indexable !== false
    return {
      meta: indexable ? [] : [{ name: 'robots', content: 'noindex, nofollow' }],
    }
  },
  component: HelpCenterLayoutRoute,
})

function HelpCenterLayoutRoute() {
  const { helpCenterConfig } = Route.useLoaderData()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const additionalLocales = helpCenterConfig?.locales?.additional ?? []
  const defaultLocale = helpCenterConfig?.locales?.default ?? 'en'
  const { locale, canonicalPath } = parseHcLocalePath(pathname, additionalLocales)

  return (
    <div className="flex flex-1 min-h-0 flex-col" dir={isRtlLocale(locale) ? 'rtl' : 'ltr'}>
      {additionalLocales.length > 0 && (
        <div className="flex justify-end px-4 py-2 sm:px-6">
          <HelpCenterLocaleSwitcher
            currentLocale={locale}
            defaultLocale={defaultLocale}
            additionalLocales={additionalLocales}
            canonicalPath={canonicalPath}
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
