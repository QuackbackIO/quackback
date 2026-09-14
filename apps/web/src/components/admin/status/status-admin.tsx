import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { SignalIcon } from '@heroicons/react/24/solid'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { AdminFilterLayout } from '@/components/admin/admin-filter-layout'
import { FilterSection } from '@/components/shared/filter-section'
import { MENU_ROW } from '@/components/ui/menu'
import { cn } from '@/lib/shared/utils'
import { Route } from '@/routes/admin/status'
import { listStatusIncidentsAdminFn } from '@/lib/server/functions/status'
import {
  statusComponentQueries,
  statusKeys,
  statusSubscriberQueries,
} from '@/lib/client/queries/status'
import { StatusIncidentList } from './status-incident-list'
import { StatusIncidentModal } from './status-incident-editor'
import { StatusOverviewView } from './status-overview-view'
import { StatusComponentsView } from './status-components-view'
import { StatusTemplatesView } from './status-templates-view'
import { StatusSubscribersView } from './status-subscribers-view'

export type StatusAdminView =
  'overview' | 'open' | 'maintenance' | 'all' | 'components' | 'templates' | 'subscribers'

function useIncidentCount(kind: 'incident' | 'maintenance', state: 'active' | 'all') {
  const { data } = useQuery({
    queryKey: [...statusKeys.incidentList({ kind, state }), 'count'],
    queryFn: () => listStatusIncidentsAdminFn({ data: { kind, state, limit: 50 } }),
    staleTime: 15 * 1000,
  })
  if (!data) return undefined
  return data.hasMore ? `${data.items.length}+` : data.items.length
}

function CountBadge({ count }: { count: number | string | undefined }) {
  if (count === undefined) return null
  return (
    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{count}</span>
  )
}

function SideItem({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  count?: number | string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      className={cn(
        MENU_ROW,
        'w-full',
        active
          ? 'bg-muted text-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      <CountBadge count={count} />
    </button>
  )
}

function StatusFilterNav({ view }: { view: StatusAdminView }) {
  const navigate = useNavigate({ from: Route.fullPath })
  const openCount = useIncidentCount('incident', 'active')
  const maintenanceCount = useIncidentCount('maintenance', 'active')
  const componentsQuery = useQuery(statusComponentQueries.list())
  const subscriberCounts = useQuery(statusSubscriberQueries.counts())

  const componentCount = componentsQuery.data
    ? componentsQuery.data.groups.reduce((n, g) => n + g.components.length, 0) +
      componentsQuery.data.ungrouped.length
    : undefined

  function go(next: StatusAdminView) {
    void navigate({ to: '/admin/status', search: { view: next } })
  }

  return (
    <div className="space-y-0 flex flex-col h-full">
      <div className="space-y-1 pb-4">
        <SideItem active={view === 'overview'} onClick={() => go('overview')}>
          Overview
        </SideItem>
      </div>
      <FilterSection title="Incidents">
        <div className="space-y-1">
          <SideItem active={view === 'open'} onClick={() => go('open')} count={openCount}>
            Open incidents
          </SideItem>
          <SideItem
            active={view === 'maintenance'}
            onClick={() => go('maintenance')}
            count={maintenanceCount}
          >
            Scheduled maintenance
          </SideItem>
          <SideItem active={view === 'all'} onClick={() => go('all')}>
            All incidents
          </SideItem>
        </div>
      </FilterSection>

      <FilterSection title="Manage">
        <div className="space-y-1">
          <SideItem
            active={view === 'components'}
            onClick={() => go('components')}
            count={componentCount}
          >
            Services
          </SideItem>
          <SideItem active={view === 'templates'} onClick={() => go('templates')}>
            Templates
          </SideItem>
          <SideItem
            active={view === 'subscribers'}
            onClick={() => go('subscribers')}
            count={subscriberCounts.data?.total}
          >
            Subscribers
          </SideItem>
        </div>
      </FilterSection>

      {/* The status page's two other surfaces, one click away: the page
          visitors see, and its settings (which live under /admin/settings). */}
      <div className="mt-2 pt-2 border-t border-border/40 space-y-1">
        <a
          href="/status"
          target="_blank"
          rel="noreferrer"
          className={cn(
            MENU_ROW,
            'w-full text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
        >
          View public page
          <ArrowTopRightOnSquareIcon className="h-3 w-3" />
        </a>
        <Link
          to="/admin/settings/status"
          className={cn(
            MENU_ROW,
            'w-full text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
        >
          Page settings
        </Link>
      </div>
    </div>
  )
}

export function StatusAdmin() {
  const search = Route.useSearch()
  const view: StatusAdminView = search.view ?? 'overview'

  return (
    <>
      <AdminFilterLayout
        headerIcon={SignalIcon}
        headerTitle="Status"
        filters={<StatusFilterNav view={view} />}
      >
        {view === 'overview' && <StatusOverviewView />}
        {view === 'open' && (
          <StatusIncidentList
            kind="incident"
            state="active"
            emptyMessage="No open incidents. All clear."
          />
        )}
        {view === 'maintenance' && (
          <StatusIncidentList
            kind="maintenance"
            state="active"
            emptyMessage="No maintenance scheduled."
          />
        )}
        {view === 'all' && <StatusIncidentList state="all" emptyMessage="No incidents yet." />}
        {view === 'components' && <StatusComponentsView />}
        {view === 'templates' && <StatusTemplatesView />}
        {view === 'subscribers' && <StatusSubscribersView />}
      </AdminFilterLayout>

      <StatusIncidentModal incidentId={search.incident} />
    </>
  )
}
