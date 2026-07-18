/**
 * Admin Overview — the on-call landing view (Status Admin Redesign spec,
 * Phase 2). Answers "what does the public see right now" before anything
 * else: a banner mirroring the portal hero (same worst-of derivation, same
 * copy), active incidents with Post update one click away, upcoming
 * maintenance with Start now, service health, and stat tiles.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowTopRightOnSquareIcon, CheckCircleIcon, PencilIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { TimeAgo } from '@/components/ui/time-ago'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Route } from '@/routes/admin/status'
import { statusOverviewQueries, type StatusOverview } from '@/lib/client/queries/status'
import { useStartStatusMaintenanceNow } from '@/lib/client/mutations/status'
import { LifecycleBadge } from './status-incident-fields'
import { ReportIncidentDialog } from './status-report-incident-dialog'
import { ScheduleMaintenanceDialog } from './status-schedule-maintenance-dialog'
import {
  COMPONENT_STATUS_COLORS,
  COMPONENT_STATUS_LABELS,
  IMPACT_COLORS,
  IMPACT_LABELS,
  TOP_LEVEL_HEADLINES,
  type StatusComponentStatus,
  type StatusIncidentLifecycle,
} from './status-admin-colors'

type OverviewIncident = StatusOverview['activeIncidents'][number]

export function StatusOverviewView() {
  const { data, isLoading } = useQuery(statusOverviewQueries.get())

  return (
    <div className="max-w-5xl w-full flex flex-col flex-1 min-h-0">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2.5 flex items-center gap-2 border-b border-border/40">
        <h2 className="text-sm font-semibold px-1">Overview</h2>
        <div className="flex items-center gap-2 ml-auto">
          <ScheduleMaintenanceDialog />
          <ReportIncidentDialog />
        </div>
      </div>

      {isLoading || !data ? <OverviewSkeleton /> : <OverviewBody data={data} />}
    </div>
  )
}

function OverviewBody({ data }: { data: StatusOverview }) {
  const allComponents = [...data.ungroupedComponents, ...data.groups.flatMap((g) => g.components)]
  const affectedCount = allComponents.filter((c) => c.status !== 'operational').length

  return (
    <div className="p-3 space-y-3">
      {!data.enabled && <DisabledNotice />}
      <PublicStateBanner
        status={data.topLevelStatus as StatusComponentStatus}
        activeCount={data.activeIncidents.length}
        affectedCount={affectedCount}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-3 items-start">
        <div className="space-y-3 min-w-0">
          <ActiveIncidentsCard incidents={data.activeIncidents} />
          <UpcomingMaintenanceCard windows={data.upcomingMaintenance} />
          <StatTiles data={data} />
        </div>
        <ServiceHealthCard data={data} />
      </div>
    </div>
  )
}

function DisabledNotice() {
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center gap-3 text-sm">
      <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
      <span className="text-foreground/90">
        The status page is turned off, so visitors can't see any of this yet.
      </span>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto shrink-0"
        onClick={() => void navigate({ to: '/admin/settings/status' })}
      >
        Page settings
      </Button>
    </div>
  )
}

function PublicStateBanner({
  status,
  activeCount,
  affectedCount,
}: {
  status: StatusComponentStatus
  activeCount: number
  affectedCount: number
}) {
  const hex = COMPONENT_STATUS_COLORS[status]
  const parts: string[] = []
  parts.push(
    activeCount === 0
      ? 'No active incidents'
      : `${activeCount} active incident${activeCount === 1 ? '' : 's'}`
  )
  if (affectedCount > 0) {
    parts.push(`${affectedCount} service${affectedCount === 1 ? '' : 's'} affected`)
  }

  return (
    <div
      className="rounded-xl border px-4 py-4 flex items-center gap-4 flex-wrap"
      style={{ borderColor: `${hex}4d`, backgroundColor: `${hex}12` }}
    >
      <span
        className="h-8 w-8 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${hex}26` }}
        aria-hidden="true"
      >
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: hex }} />
      </span>
      <div className="flex-1 min-w-48">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Visitors currently see
        </p>
        <h3 className="text-lg font-semibold leading-tight mt-0.5">
          {TOP_LEVEL_HEADLINES[status]}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">{parts.join(' · ')}</p>
      </div>
      <Button variant="outline" size="sm" asChild>
        <a href="/status" target="_blank" rel="noreferrer">
          Open public page
          <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 ml-1.5" />
        </a>
      </Button>
    </div>
  )
}

function CardShell({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <h4 className="text-[13px] font-semibold">{title}</h4>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  )
}

function ViewAllLink({
  view,
  label = 'View all',
}: {
  view: 'open' | 'maintenance' | 'components'
  label?: string
}) {
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <button
      type="button"
      onClick={() => void navigate({ to: '/admin/status', search: { view } })}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
    </button>
  )
}

function useGoToIncident() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  return (id: string) => void navigate({ to: '/admin/status', search: { ...search, incident: id } })
}

function ActiveIncidentsCard({ incidents }: { incidents: OverviewIncident[] }) {
  const goToIncident = useGoToIncident()

  if (incidents.length === 0) {
    return (
      <CardShell title="Active incidents">
        <div className="px-4 py-5 flex items-center gap-2.5 text-sm text-muted-foreground">
          <CheckCircleIcon className="h-5 w-5 text-emerald-500" />
          No active incidents. All clear.
        </div>
      </CardShell>
    )
  }

  return (
    <CardShell title="Active incidents" action={<ViewAllLink view="open" />}>
      <div className="divide-y divide-border/40">
        {incidents.map((incident) => {
          const latest = incident.updates[incident.updates.length - 1]
          const lifecycle = incident.status as StatusIncidentLifecycle
          return (
            <div key={incident.id} className="px-4 py-3 space-y-2">
              <div className="flex items-start gap-2.5">
                <span
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: IMPACT_COLORS[incident.impact] }}
                />
                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    className="font-semibold text-sm text-left hover:underline underline-offset-2 line-clamp-1"
                    onClick={() => goToIncident(incident.id)}
                  >
                    {incident.title}
                  </button>
                  <div className="flex items-center flex-wrap gap-2 text-[11px] text-muted-foreground mt-1">
                    <LifecycleBadge status={lifecycle} />
                    <Badge variant="outline" size="sm">
                      {IMPACT_LABELS[incident.impact]}
                    </Badge>
                    {incident.affectedComponents.slice(0, 3).map((c) => (
                      <span key={c.componentId}>{c.name}</span>
                    ))}
                    <span className="text-muted-foreground/50">·</span>
                    <span>
                      Started <TimeAgo date={incident.startedAt} />
                    </span>
                  </div>
                </div>
                <Button size="sm" onClick={() => goToIncident(incident.id)}>
                  Post update
                </Button>
              </div>
              {latest && (
                <p className="text-xs text-muted-foreground border-l-2 border-border pl-2.5 ml-1 line-clamp-2">
                  <span className="text-foreground/80 font-medium">
                    Latest update <TimeAgo date={latest.createdAt} />:
                  </span>{' '}
                  {latest.body}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}

function formatWindow(startIso: string | null, endIso: string | null): string {
  if (!startIso) return 'Not scheduled'
  const start = new Date(startIso)
  const day = start.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return endIso ? `${day}, ${time(start)} – ${time(new Date(endIso))}` : `${day}, ${time(start)}`
}

function UpcomingMaintenanceCard({ windows }: { windows: OverviewIncident[] }) {
  const goToIncident = useGoToIncident()
  const startMutation = useStartStatusMaintenanceNow()
  const [startTarget, setStartTarget] = useState<OverviewIncident | null>(null)

  if (windows.length === 0) return null

  return (
    <>
      <CardShell title="Upcoming maintenance" action={<ViewAllLink view="maintenance" />}>
        <div className="divide-y divide-border/40">
          {windows.map((w) => {
            const start = w.scheduledStartAt ? new Date(w.scheduledStartAt) : null
            const lifecycle = w.status as StatusIncidentLifecycle
            return (
              <div key={w.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-11 shrink-0 rounded-lg border border-border/60 text-center overflow-hidden">
                  <div className="text-[11px] font-bold tracking-wide uppercase bg-blue-500/15 text-blue-600 dark:text-blue-400 py-0.5">
                    {start ? start.toLocaleDateString(undefined, { month: 'short' }) : '—'}
                  </div>
                  <div className="text-base font-semibold py-0.5 tabular-nums">
                    {start ? start.getDate() : '?'}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    className="font-semibold text-sm text-left hover:underline underline-offset-2 line-clamp-1"
                    onClick={() => goToIncident(w.id)}
                  >
                    {w.title}
                  </button>
                  <div className="flex items-center flex-wrap gap-2 text-[11px] text-muted-foreground mt-1">
                    <LifecycleBadge status={lifecycle} />
                    <span>{formatWindow(w.scheduledStartAt, w.scheduledEndAt)}</span>
                    {w.autoStart && (
                      <Badge variant="outline" size="sm">
                        Auto-start
                      </Badge>
                    )}
                    {w.autoComplete && (
                      <Badge variant="outline" size="sm">
                        Auto-complete
                      </Badge>
                    )}
                  </div>
                </div>
                {w.status === 'scheduled' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStartTarget(w)}
                    disabled={startMutation.isPending}
                  >
                    Start now
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => goToIncident(w.id)}
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      </CardShell>

      <ConfirmDialog
        open={!!startTarget}
        onOpenChange={(o) => !o && setStartTarget(null)}
        title="Start maintenance now?"
        description="The window begins immediately: affected services switch to Under maintenance on the public page and an update is posted to the timeline. Subscribers are not emailed."
        confirmLabel="Start now"
        isPending={startMutation.isPending}
        onConfirm={() => {
          if (!startTarget) return
          startMutation.mutate(startTarget.id, {
            onSuccess: () => {
              setStartTarget(null)
              toast.success('Maintenance started')
            },
            onError: (err) =>
              toast.error(err instanceof Error ? err.message : 'Failed to start maintenance'),
          })
        }}
      />
    </>
  )
}

function StatTiles({ data }: { data: StatusOverview }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm grid grid-cols-3 divide-x divide-border/40">
      <div className="px-4 py-3">
        <p className="text-lg font-semibold tabular-nums">
          {data.uptime90d === null ? '—' : `${data.uptime90d.toFixed(2)}%`}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">90-day uptime, all services</p>
      </div>
      <div className="px-4 py-3">
        <p className="text-lg font-semibold tabular-nums">
          {data.subscribers.active.toLocaleString()}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">Subscribers</p>
        {data.subscribers.newLast7d > 0 && (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
            +{data.subscribers.newLast7d} this week
          </p>
        )}
      </div>
      <div className="px-4 py-3">
        <p className="text-lg font-semibold tabular-nums">{data.incidentsLast30d}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">Incidents in the last 30 days</p>
      </div>
    </div>
  )
}

function ServiceHealthCard({ data }: { data: StatusOverview }) {
  const hasAny = data.ungroupedComponents.length > 0 || data.groups.length > 0

  return (
    <CardShell title="Service health" action={<ViewAllLink view="components" label="Manage" />}>
      {!hasAny ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">
          No services yet. Add the systems you want to report status for.
        </div>
      ) : (
        <div>
          {data.ungroupedComponents.map((c) => (
            <ServiceRow key={c.id} name={c.name} status={c.status as StatusComponentStatus} />
          ))}
          {data.groups.map((g) => (
            <div key={g.id}>
              <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-t border-border/40">
                {g.name}
              </div>
              {g.components.map((c) => (
                <ServiceRow key={c.id} name={c.name} status={c.status as StatusComponentStatus} />
              ))}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

function ServiceRow({ name, status }: { name: string; status: StatusComponentStatus }) {
  return (
    <div className="px-4 py-2 flex items-center gap-2.5 text-sm border-t border-border/30 first:border-t-0">
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ backgroundColor: COMPONENT_STATUS_COLORS[status] }}
      />
      <span className="truncate">{name}</span>
      <span
        className="ml-auto text-xs font-medium shrink-0"
        style={{ color: COMPONENT_STATUS_COLORS[status] }}
      >
        {COMPONENT_STATUS_LABELS[status]}
      </span>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="p-3 space-y-3">
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-3">
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  )
}
