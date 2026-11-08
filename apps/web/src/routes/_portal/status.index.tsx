import { createFileRoute, notFound, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { AreaMessages } from '@/components/shared/area-messages'
import { DEFAULT_LOCALE, loadAreaMessages } from '@/lib/shared/i18n'
import { publicStatusPageQueries } from '@/lib/client/queries/status'
import { setPublicDocumentCacheHeaders } from '@/lib/server/functions/public-cache'
import {
  StatusSignInPrompt,
  useStatusSignInCouldGrantAccess,
  useRefreshStatusForViewer,
} from '@/components/portal/status'
import { StatusPageView } from '@/components/portal/status/status-page-view'
import { PORTAL_LANDING } from '@/lib/shared/design/paths'
import {
  headSettings,
  pageShareMeta,
  pageTitle,
  portalHeadWords,
  portalSiteName,
} from '@/lib/shared/portal-head'

export const Route = createFileRoute('/_portal/status/')({
  loader: async ({ context }) => {
    if (typeof window === 'undefined') await setPublicDocumentCacheHeaders()
    // The status page's strings stay out of the catalog every other page
    // seeds; the page reads them with its data.
    const messagesPromise = loadAreaMessages(
      context.acceptLanguageLocale ?? DEFAULT_LOCALE,
      'statusPage'
    )
    try {
      await context.queryClient.ensureQueryData(publicStatusPageQueries.get())
    } catch {
      // Gated out (disabled, feature flag off, or audience denies this
      // viewer) — mirrors `changelog.$entryId.tsx`'s try/catch -> notFound(),
      // since `getStatusPageFn` explicitly 404s for both "gated" and
      // "genuinely unavailable" (Status Product Spec §4).
      throw notFound()
    }
    return {
      workspaceName: context.settings?.name ?? 'Quackback',
      baseUrl: context.baseUrl ?? '',
      messages: await messagesPromise,
    }
  },
  head: ({ loaderData, matches }) => {
    if (!loaderData) return {}
    const { baseUrl } = loaderData
    const settings = headSettings(matches)
    const title = pageTitle(settings, 'status')
    const description = portalHeadWords(settings).status(portalSiteName(settings))
    const canonicalUrl = baseUrl ? `${baseUrl}/status` : ''
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(canonicalUrl ? [{ property: 'og:url', content: canonicalUrl }] : []),
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        ...pageShareMeta(settings, baseUrl, 'status'),
      ],
      links: canonicalUrl ? [{ rel: 'canonical', href: canonicalUrl }] : [],
    }
  },
  notFoundComponent: () => (
    <AreaMessages area="statusPage">
      <StatusPageNotFound />
    </AreaMessages>
  ),
  component: StatusPageRoute,
})

function StatusPageRoute() {
  const { messages } = Route.useLoaderData()
  return (
    <AreaMessages area="statusPage" messages={messages}>
      <StatusPage />
    </AreaMessages>
  )
}

function StatusPage() {
  useRefreshStatusForViewer()
  const { data } = useSuspenseQuery(publicStatusPageQueries.get())
  return <StatusPageView data={data} />
}

function StatusPageNotFound() {
  // Gated pages 404 like missing ones; a signed-out visitor who could get in
  // by signing in is told so instead.
  const signInCouldGrantAccess = useStatusSignInCouldGrantAccess()
  if (signInCouldGrantAccess) {
    return (
      <div className="mx-auto max-w-[var(--qb-page-max,72rem)] w-full px-4 sm:px-6 py-16 text-center">
        <StatusSignInPrompt />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-[var(--qb-page-max,72rem)] w-full px-4 sm:px-6 py-16 text-center">
      <h1 className="text-2xl font-bold mb-2">
        <FormattedMessage
          id="portal.status.notFound.title"
          defaultMessage="Status page not available"
        />
      </h1>
      <p className="text-muted-foreground mb-6">
        <FormattedMessage
          id="portal.status.notFound.description"
          defaultMessage="This status page isn't published, or you don't have access to view it."
        />
      </p>
      <Link to={PORTAL_LANDING} className="text-sm font-medium text-primary hover:underline">
        <FormattedMessage id="portal.status.notFound.backLink" defaultMessage="Go home" />
      </Link>
    </div>
  )
}
