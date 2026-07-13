import { useMemo, useState } from 'react'
import { createFileRoute, notFound, Link } from '@tanstack/react-router'
import { useSuspenseQuery, useInfiniteQuery } from '@tanstack/react-query'
import { useIntl, FormattedMessage } from 'react-intl'
import { RssIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { publicStatusPageQueries, publicStatusHistoryQueries } from '@/lib/client/queries/status'
import {
  StatusHero,
  StatusComponentsList,
  StatusIncidentCard,
  StatusIncidentTimeline,
  StatusSubscribeButton,
  LIFECYCLE_STYLE,
  LIFECYCLE_LABEL,
} from '@/components/portal/status'
import type { StatusUptimeDay } from '@/components/portal/status'

export const Route = createFileRoute('/_portal/status/')({
  loader: async ({ context }) => {
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
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { workspaceName, baseUrl } = loaderData
    const title = `Status - ${workspaceName}`
    const description = `Live status and incident history for ${workspaceName}.`
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
      ],
      links: canonicalUrl ? [{ rel: 'canonical', href: canonicalUrl }] : [],
    }
  },
  notFoundComponent: StatusPageNotFound,
  component: StatusPage,
})

function formatUtcDayLong(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatMaintenanceWindow(startIso: string | null, endIso: string | null): string {
  if (!startIso) return ''
  const start = new Date(startIso)
  const dayLabel = start.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const startTime = start.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
  if (!endIso) return `${dayLabel} · ${startTime} UTC`
  const endTime = new Date(endIso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
  return `${dayLabel} · ${startTime} – ${endTime} UTC`
}

function StatusPage() {
  const intl = useIntl()
  const { data } = useSuspenseQuery(publicStatusPageQueries.get())
  const { snapshot, settings, uptime } = data

  const uptimeByComponentId = useMemo(() => {
    const map = new Map<string, StatusUptimeDay[]>()
    for (const series of uptime ?? []) {
      map.set(series.componentId, series.days)
    }
    return map
  }, [uptime])

  const lastUpdatedAt = useMemo(() => {
    const timestamps = [...snapshot.activeIncidents, ...snapshot.upcomingMaintenance].flatMap(
      (incident) => incident.updates.map((u) => u.createdAt)
    )
    if (timestamps.length === 0) return null
    return timestamps.reduce((latest, ts) => (ts > latest ? ts : latest))
  }, [snapshot])

  const [historyExpanded, setHistoryExpanded] = useState(false)
  const {
    data: historyPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({ ...publicStatusHistoryQueries.list(), enabled: historyExpanded })
  const historyItems = historyPages?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        size="large"
        title={intl.formatMessage({ id: 'portal.status.title', defaultMessage: 'Status' })}
        description={
          settings.pageDescription ??
          intl.formatMessage({
            id: 'portal.status.description',
            defaultMessage:
              'Live status for our services. Subscribe to get notified about incidents and maintenance.',
          })
        }
        action={
          <div className="flex items-center gap-2">
            <StatusSubscribeButton />
            <Button variant="outline" size="sm" asChild className="shrink-0 gap-1.5">
              <a href="/status/feed" target="_blank" rel="noopener noreferrer">
                <RssIcon className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {intl.formatMessage({ id: 'portal.status.rssFeed', defaultMessage: 'RSS Feed' })}
                </span>
              </a>
            </Button>
          </div>
        }
        animate
        className="mb-6"
      />

      <StatusHero
        status={snapshot.topLevel.status}
        activeIncidentCount={snapshot.topLevel.activeIncidentCount}
        lastUpdatedAt={lastUpdatedAt}
      />

      {snapshot.activeIncidents.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <FormattedMessage
              id="portal.status.section.activeIncidents"
              defaultMessage="Active incidents"
            />
          </h2>
          <div className="flex flex-col gap-2.5">
            {snapshot.activeIncidents.map((incident) => (
              <StatusIncidentCard key={incident.id} incident={incident} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <FormattedMessage
            id="portal.status.section.components"
            defaultMessage="Current status by service"
          />
        </h2>
        <StatusComponentsList
          groups={snapshot.groups}
          ungroupedComponents={snapshot.ungroupedComponents}
          uptimeByComponentId={uptimeByComponentId}
        />
      </section>

      {snapshot.upcomingMaintenance.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <FormattedMessage
              id="portal.status.section.scheduledMaintenance"
              defaultMessage="Scheduled maintenance"
            />
          </h2>
          <div className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-xs">
            <div className="divide-y divide-border/40">
              {snapshot.upcomingMaintenance.map((incident) => {
                const style = LIFECYCLE_STYLE[incident.status]
                const latestUpdate = incident.updates[incident.updates.length - 1]
                const start = new Date(incident.scheduledStartAt ?? incident.startedAt)
                return (
                  <div key={incident.id} className="flex gap-3.5 p-4 sm:p-[18px]">
                    <div className="w-11 shrink-0 overflow-hidden rounded-lg border border-border/60 text-center">
                      <div className="bg-blue-500/15 py-0.5 text-xs font-bold tracking-wide text-blue-600 uppercase dark:text-blue-400">
                        {start.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}
                      </div>
                      <div className="py-0.5 text-base font-bold">
                        {start.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' })}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[14.5px] font-semibold">
                          <Link
                            to="/status/$incidentId"
                            params={{ incidentId: incident.id }}
                            className="hover:text-primary"
                          >
                            {incident.title}
                          </Link>
                        </h3>
                        <span className={cnLifecycle(style.text)}>
                          {intl.formatMessage(LIFECYCLE_LABEL[incident.status])}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {formatMaintenanceWindow(
                          incident.scheduledStartAt,
                          incident.scheduledEndAt
                        )}
                        {latestUpdate ? ` · ${latestUpdate.body}` : ''}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {incident.affectedComponents.map((component) => (
                          <span
                            key={component.id}
                            className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground"
                          >
                            {component.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <FormattedMessage
              id="portal.status.section.pastIncidents"
              defaultMessage="Past incidents"
            />
          </h2>
          {!historyExpanded && (
            <button
              type="button"
              onClick={() => setHistoryExpanded(true)}
              className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              <FormattedMessage
                id="portal.status.section.history"
                defaultMessage="Incident history →"
              />
            </button>
          )}
        </div>

        <div className="divide-y divide-border/40">
          {snapshot.recentIncidents.map((day) => (
            <div key={day.date} className="py-3.5 first:pt-0">
              <p className="mb-1.5 text-[13px] font-semibold text-muted-foreground">
                {formatUtcDayLong(day.date)}
              </p>
              {day.incidents.length === 0 ? (
                <p className="text-[13px] text-muted-foreground/75">
                  <FormattedMessage
                    id="portal.status.noIncidentsReported"
                    defaultMessage="No incidents reported."
                  />
                </p>
              ) : (
                <div className="flex flex-col gap-3.5">
                  {day.incidents.map((incident) => (
                    <div key={incident.id}>
                      <h4 className="text-[14.5px] font-semibold">
                        <Link
                          to="/status/$incidentId"
                          params={{ incidentId: incident.id }}
                          className="hover:text-primary"
                        >
                          {incident.title}
                        </Link>
                      </h4>
                      <StatusIncidentTimeline
                        updates={incident.updates}
                        compact
                        className="mt-1.5"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {historyExpanded && historyItems.length > 0 && (
          <div className="mt-4 flex flex-col gap-3.5 border-t border-border/40 pt-4">
            {historyItems.map((incident) => (
              <div key={incident.id}>
                <p className="text-xs text-muted-foreground">
                  {new Date(incident.startedAt).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </p>
                <h4 className="text-[14.5px] font-semibold">
                  <Link
                    to="/status/$incidentId"
                    params={{ incidentId: incident.id }}
                    className="hover:text-primary"
                  >
                    {incident.title}
                  </Link>
                </h4>
                <StatusIncidentTimeline updates={incident.updates} compact className="mt-1.5" />
              </div>
            ))}
          </div>
        )}

        {historyExpanded && hasNextPage && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? (
                <FormattedMessage
                  id="portal.status.history.loadingMore"
                  defaultMessage="Loading..."
                />
              ) : (
                <FormattedMessage id="portal.status.history.loadMore" defaultMessage="Load more" />
              )}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

function cnLifecycle(textClass: string): string {
  return `text-[11px] font-semibold uppercase tracking-wide ${textClass}`
}

function StatusPageNotFound() {
  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-16 text-center">
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
      <Link to="/" className="text-sm font-medium text-primary hover:underline">
        <FormattedMessage id="portal.status.notFound.backLink" defaultMessage="Go home" />
      </Link>
    </div>
  )
}
