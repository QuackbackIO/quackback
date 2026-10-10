import { createFileRoute, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { publicStatusIncidentQueries } from '@/lib/client/queries/status'
import { setPublicDocumentCacheHeaders } from '@/lib/server/functions/public-cache'
import {
  StatusIncidentTimeline,
  StatusSubscribeButton,
  StatusSignInPrompt,
  useStatusSignInCouldGrantAccess,
  IMPACT_STYLE,
  IMPACT_LABEL,
  LIFECYCLE_STYLE,
  LIFECYCLE_LABEL,
} from '@/components/portal/status'
import { BackLink } from '@/components/ui/back-link'
import { AreaMessages } from '@/components/shared/area-messages'
import { DEFAULT_LOCALE, loadAreaMessages } from '@/lib/shared/i18n'
import type { StatusIncidentId } from '@quackback/ids'

export const Route = createFileRoute('/_portal/status/$incidentId')({
  loader: async ({ context, params }) => {
    if (typeof window === 'undefined') await setPublicDocumentCacheHeaders()
    const incidentId = params.incidentId as StatusIncidentId
    // The status page's strings stay out of the catalog every other page
    // seeds; the page reads them with its data.
    const messagesPromise = loadAreaMessages(
      context.acceptLanguageLocale ?? DEFAULT_LOCALE,
      'statusPage'
    )

    let incident
    try {
      incident = await context.queryClient.ensureQueryData(
        publicStatusIncidentQueries.detail(incidentId)
      )
    } catch {
      // Gated out or genuinely missing — `getStatusIncidentPublicFn` 404s the
      // same way for both, matching `changelog.$entryId.tsx`'s convention.
      throw notFound()
    }

    return {
      incidentId,
      incidentTitle: incident.title,
      workspaceName: context.settings?.name ?? 'Quackback',
      baseUrl: context.baseUrl ?? '',
      messages: await messagesPromise,
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { incidentTitle, incidentId, workspaceName, baseUrl } = loaderData
    const title = `${incidentTitle} - ${workspaceName} Status`
    const description = `${incidentTitle}. A status update from ${workspaceName}.`
    const canonicalUrl = baseUrl ? `${baseUrl}/status/${incidentId}` : ''
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(canonicalUrl ? [{ property: 'og:url', content: canonicalUrl }] : []),
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
      ],
      links: canonicalUrl ? [{ rel: 'canonical', href: canonicalUrl }] : [],
    }
  },
  notFoundComponent: () => (
    <AreaMessages area="statusPage">
      <StatusIncidentNotFound />
    </AreaMessages>
  ),
  component: StatusIncidentRoute,
})

function StatusIncidentRoute() {
  const { messages } = Route.useLoaderData()
  return (
    <AreaMessages area="statusPage" messages={messages}>
      <StatusIncidentPage />
    </AreaMessages>
  )
}

function StatusIncidentPage() {
  const intl = useIntl()
  const { incidentId } = Route.useLoaderData()
  const { data: incident } = useSuspenseQuery(publicStatusIncidentQueries.detail(incidentId))

  const impactStyle = IMPACT_STYLE[incident.impact]
  const lifecycleStyle = LIFECYCLE_STYLE[incident.status]

  return (
    <div className="mx-auto max-w-3xl w-full px-4 sm:px-6 py-8">
      <div className="animate-in fade-in duration-200 fill-mode-backwards">
        <BackLink to="/status" className="mb-7">
          <FormattedMessage id="portal.status.incidentDetail.backLink" defaultMessage="Status" />
        </BackLink>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 text-2xl font-bold leading-tight tracking-tight">
            {incident.title}
          </h1>
          <StatusSubscribeButton />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span
            className={cn(
              'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
              impactStyle.soft,
              impactStyle.text
            )}
          >
            {intl.formatMessage(IMPACT_LABEL[incident.impact])}
          </span>
          <span
            className={cn('text-[11px] font-semibold tracking-wide uppercase', lifecycleStyle.text)}
          >
            {intl.formatMessage(LIFECYCLE_LABEL[incident.status])}
          </span>
          <span className="text-xs text-muted-foreground">
            {intl.formatMessage(
              { id: 'portal.status.incidentDetail.started', defaultMessage: 'Started {date}' },
              {
                date:
                  new Date(incident.startedAt).toLocaleString(intl.locale, {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                    timeZone: 'UTC',
                  }) + ' UTC',
              }
            )}
          </span>
        </div>

        {incident.affectedComponents.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              <FormattedMessage
                id="portal.status.incidentDetail.affected"
                defaultMessage="Affected:"
              />
            </span>
            {incident.affectedComponents.map((component) => (
              <span
                key={component.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {component.name}
              </span>
            ))}
          </div>
        )}

        <h2 className="mt-8 mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <FormattedMessage id="portal.status.incidentDetail.updates" defaultMessage="Updates" />
        </h2>
        <StatusIncidentTimeline updates={incident.updates} />
      </div>
    </div>
  )
}

function StatusIncidentNotFound() {
  // An incident link from an email lands here too: when the page is for
  // signed-in visitors, signing in is the way through.
  const signInCouldGrantAccess = useStatusSignInCouldGrantAccess()
  if (signInCouldGrantAccess) {
    return (
      <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-16 text-center">
        <StatusSignInPrompt />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-16 text-center">
      <h1 className="text-2xl font-bold mb-2">
        <FormattedMessage
          id="portal.status.incidentDetail.notFound.title"
          defaultMessage="Incident not found"
        />
      </h1>
      <p className="text-muted-foreground mb-6">
        <FormattedMessage
          id="portal.status.incidentDetail.notFound.description"
          defaultMessage="This incident may have been removed, or you don't have access to view it."
        />
      </p>
      <BackLink to="/status">
        <FormattedMessage
          id="portal.status.incidentDetail.notFound.backLink"
          defaultMessage="Status"
        />
      </BackLink>
    </div>
  )
}
