import { createFileRoute, redirect } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import {
  helpCenterAbsoluteUrl,
  helpCenterHeadMessages,
  helpCenterHeadPortal,
} from '@/components/help-center/help-center-head'
import {
  listPublicCategoriesFn,
  listPopularPublicArticlesFn,
} from '@/lib/server/functions/help-center'
import { HC_LOCALE_COOKIE, resolveHcLandingLocale } from '@/lib/shared/help-center-url'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'
import { HelpCenterLandingView } from '@/components/help-center/help-center-landing-view'
import { landingCopy } from '@/components/help-center/landing-copy'
import { resolvePortalOgImageUrl } from '@/lib/shared/portal-og-image'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

/**
 * SSR-only request context for browser-locale detection. The isomorphic split
 * keeps the server-only header import out of the client bundle
 * (import-protection denies it there); a client-side nav that already landed
 * here has nothing to detect.
 */
const landingRequestContext = createIsomorphicFn()
  .client((): { cookieHeader: string; acceptLanguage: string | null } | null => null)
  .server((): { cookieHeader: string; acceptLanguage: string | null } | null => {
    try {
      const headers = getRequestHeaders()
      return {
        cookieHeader: headers.get('cookie') ?? '',
        acceptLanguage: headers.get('accept-language'),
      }
    } catch {
      return null
    }
  })

/** Only meaningful during SSR (browser-detect needs the real request headers/cookies). */
function landingLocaleRedirectTarget(helpCenterConfig?: HelpCenterConfig): string | null {
  const additional = helpCenterConfig?.locales?.additional ?? []
  if (additional.length === 0) return null
  const req = landingRequestContext()
  if (!req) return null
  const cookieMatch = new RegExp(`${HC_LOCALE_COOKIE}=([^;]+)`).exec(req.cookieHeader)
  return resolveHcLandingLocale({
    cookieLocale: cookieMatch?.[1] ?? null,
    acceptLanguage: req.acceptLanguage,
    enabledAdditionalLocales: additional,
    defaultLocale: helpCenterConfig?.locales?.default ?? 'en',
  })
}

export const Route = createFileRoute('/_portal/hc/')({
  beforeLoad: async ({ context }) => {
    const { settings } = context
    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    const target = landingLocaleRedirectTarget(helpCenterConfig)
    if (target) throw redirect({ to: `/hc/${target}` as '/', replace: true })
  },
  loader: async ({ context }) => {
    const { settings } = context
    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    const [categories, popularArticles] = await Promise.all([
      listPublicCategoriesFn({ data: {} }),
      listPopularPublicArticlesFn({ data: { limit: 6 } }),
    ])

    return {
      categories,
      popularArticles,
      helpCenterConfig: helpCenterConfig ?? null,
      workspaceName: settings?.name ?? 'Help Center',
      logoUrl: resolvePortalOgImageUrl(
        { logoUrl: settings?.brandingData?.logoUrl },
        context.baseUrl
      ),
    }
  },
  head: ({ loaderData, matches }) => {
    if (!loaderData) return {}

    const { helpCenterConfig, workspaceName, logoUrl } = loaderData
    const messages = helpCenterHeadMessages(matches)
    const { title, description } = landingCopy(
      helpCenterConfig,
      (copy) => messages[copy.id] ?? copy.defaultMessage
    )

    const pageTitle = `${title} - ${workspaceName}`
    const { baseUrl } = helpCenterHeadPortal(matches)
    const canonicalUrl = helpCenterAbsoluteUrl(baseUrl, '/hc')

    return {
      meta: [
        { title: pageTitle },
        { name: 'description', content: description },
        { property: 'og:title', content: pageTitle },
        { property: 'og:description', content: description },
        { property: 'og:image', content: logoUrl },
        { name: 'twitter:title', content: pageTitle },
        { name: 'twitter:description', content: description },
      ],
      links: canonicalUrl ? [{ rel: 'canonical', href: canonicalUrl }] : [],
    }
  },
  component: HelpCenterLandingPage,
})

function HelpCenterLandingPage() {
  const { categories, popularArticles, helpCenterConfig } = Route.useLoaderData()
  const settings = useWorkspaceSettings()
  return (
    <HelpCenterLandingView
      categories={categories}
      popularArticles={popularArticles}
      helpCenterConfig={helpCenterConfig}
      askAiEnabled={!!settings?.featureFlags?.helpCenter}
    />
  )
}
