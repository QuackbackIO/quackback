import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SignalIcon } from '@heroicons/react/24/solid'
import { AdminFilterLayout } from '@/components/admin/admin-filter-layout'
import { FilterSection } from '@/components/shared/filter-section'
import { cn } from '@/lib/shared/utils'
import { Route } from '@/routes/admin/status'
import { listStatusIncidentsAdminFn } from '@/lib/server/functions/status'
import {
  statusComponentQueries,
  statusKeys,
  statusSubscriberQueries,
} from '@/lib/client/queries/status'
import { StatusIncidentList } from './status-incident-list'
import { StatusIncidentModal } from './status-incident-modal'
import { StatusComponentsView } from './status-components-view'
import { StatusTemplatesView } from './status-templates-view'
import { StatusSubscribersView } from './status-subscribers-view'

export type StatusAdminView =
  | 'open'
  | 'maintenance'
  | 'all'
  | 'components'
  | 'templates'
  | 'subscribers'

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
    <span className="ml-auto text-[11px] font-semibold rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
      {count}
    </span>
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
      className={cn(
        'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors text-left',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      <span className="truncate">{children}</span>
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
    <div className="space-y-1">
      <FilterSection title="Incidents" collapsible={false}>
        <div className="space-y-0.5">
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

      <FilterSection title="Manage" collapsible={false}>
        <div className="space-y-0.5">
          <SideItem
            active={view === 'components'}
            onClick={() => go('components')}
            count={componentCount}
          >
            Components
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
    </div>
  )
}

export function StatusAdmin() {
  const search = Route.useSearch()
  const view: StatusAdminView = search.view ?? 'open'

  return (
    <>
      <AdminFilterLayout
        headerIcon={SignalIcon}
        headerTitle="Status"
        filters={<StatusFilterNav view={view} />}
      >
        {view === 'open' && (
          <StatusIncidentList
            kind="incident"
            state="active"
            emptyMessage="No open incidents — all clear."
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
