import { createFileRoute, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { publicStatusIncidentQueries } from '@/lib/client/queries/status'
import {
  StatusIncidentTimeline,
  StatusSubscribeButton,
  IMPACT_STYLE,
  IMPACT_LABEL,
  LIFECYCLE_STYLE,
  LIFECYCLE_LABEL,
} from '@/components/portal/status'
import { BackLink } from '@/components/ui/back-link'
import type { StatusIncidentId } from '@quackback/ids'

export const Route = createFileRoute('/_portal/status/$incidentId')({
  loader: async ({ context, params }) => {
    const incidentId = params.incidentId as StatusIncidentId

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
  notFoundComponent: StatusIncidentNotFound,
  component: StatusIncidentPage,
})

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

        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{incident.title}</h1>

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span
            className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: `${impactStyle.hex}26`, color: impactStyle.hex }}
          >
            {intl.formatMessage(IMPACT_LABEL[incident.impact])}
          </span>
          <span
            className="text-[11px] font-semibold tracking-wide uppercase"
            style={{ color: lifecycleStyle.hex }}
          >
            {intl.formatMessage(LIFECYCLE_LABEL[incident.status])}
          </span>
          <span className="text-xs text-muted-foreground">
            {intl.formatMessage(
              { id: 'portal.status.incidentDetail.started', defaultMessage: 'Started {date}' },
              {
                date:
                  new Date(incident.startedAt).toLocaleString('en-US', {
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

        <div className="mt-5">
          <StatusSubscribeButton />
        </div>

        <StatusIncidentTimeline updates={incident.updates} className="mt-7" />
      </div>
    </div>
  )
}

function StatusIncidentNotFound() {
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
