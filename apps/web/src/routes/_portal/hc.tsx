import { createFileRoute, notFound, Outlet, useRouterState } from '@tanstack/react-router'
import { HelpCenterLocaleSwitcher } from '@/components/help-center/help-center-locale-switcher'
import { parseHcLocalePath } from '@/lib/shared/help-center-url'
import { AreaMessages } from '@/components/shared/area-messages'
import { DEFAULT_LOCALE, isRtlLocale, seedAreaMessages } from '@/lib/shared/i18n'
import type { FeatureFlags, HelpCenterConfig } from '@/lib/shared/types/settings'
import { setPublicDocumentCacheHeaders } from '@/lib/server/functions/public-cache'

export const Route = createFileRoute('/_portal/hc')({
  beforeLoad: async ({ context }) => {
    const { settings } = context

    const flags = settings?.featureFlags as FeatureFlags | undefined
    if (!flags?.helpCenter) throw notFound()

    // The primary domain's /hc pages move to the help center's own domain in
    // the section host middleware (lib/server/middleware/section-host.ts).
  },
  loader: async ({ context }) => {
    const { settings } = context
    const helpCenterConfig = (settings?.helpCenterConfig as HelpCenterConfig | null) ?? null
    // Help center strings stay out of the catalog every other page seeds;
    // these pages read them with the page.
    const [messages] = await Promise.all([
      seedAreaMessages(context.acceptLanguageLocale ?? DEFAULT_LOCALE, 'helpCenter'),
      typeof window === 'undefined' ? setPublicDocumentCacheHeaders() : undefined,
    ])
    return { helpCenterConfig, messages }
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
  const { helpCenterConfig, messages } = Route.useLoaderData()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const additionalLocales = helpCenterConfig?.locales?.additional ?? []
  const defaultLocale = helpCenterConfig?.locales?.default ?? 'en'
  const { locale, canonicalPath } = parseHcLocalePath(pathname, [
    defaultLocale,
    ...additionalLocales,
  ])

  return (
    <AreaMessages area="helpCenter" messages={messages}>
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
    </AreaMessages>
  )
}
