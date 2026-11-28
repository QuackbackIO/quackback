import { useQuery } from '@tanstack/react-query'
import {
  CalendarIcon,
  ClockIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  ServerStackIcon,
  SignalIcon,
} from '@heroicons/react/24/solid'
import { useNavigate } from '@tanstack/react-router'
import { AdminFilterLayout } from '@/components/admin/admin-filter-layout'
import { FilterSection } from '@/components/shared/filter-section'
import { MENU_ICON, MENU_ROW } from '@/components/ui/menu'
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
import {
  StatusNoAccess,
  canOpenStatusView,
  defaultStatusView,
  useStatusAccess,
  type StatusAccess,
  type StatusAdminView,
} from './status-access'

export type { StatusAdminView } from './status-access'

function useIncidentCount(
  kind: 'incident' | 'maintenance',
  state: 'active' | 'all',
  enabled: boolean
) {
  const { data } = useQuery({
    queryKey: [...statusKeys.incidentList({ kind, state }), 'count'],
    queryFn: () => listStatusIncidentsAdminFn({ data: { kind, state, limit: 50 } }),
    staleTime: 15 * 1000,
    enabled,
  })
  if (!data) return undefined
  return data.hasMore ? `${data.items.length}+` : data.items.length
}

function CountBadge({ count }: { count: number | string | undefined }) {
  if (count === undefined) return null
  return (
    <span className="ms-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{count}</span>
  )
}

function SideItem({
  active,
  onClick,
  icon: Icon,
  children,
  count,
}: {
  active: boolean
  onClick: () => void
  icon: React.ElementType
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
      <Icon className={MENU_ICON} />
      <span className="min-w-0 flex-1 truncate text-start">{children}</span>
      <CountBadge count={count} />
    </button>
  )
}

/** The views this role can open, and only those; counts are read only
 *  where the role can read what they count. */
function StatusFilterNav({ view, access }: { view: StatusAdminView; access: StatusAccess }) {
  const navigate = useNavigate({ from: Route.fullPath })
  const openCount = useIncidentCount('incident', 'active', access.canPublish)
  const maintenanceCount = useIncidentCount('maintenance', 'active', access.canPublish)
  const componentsQuery = useQuery({ ...statusComponentQueries.list(), enabled: access.canManage })
  const subscriberCounts = useQuery({
    ...statusSubscriberQueries.counts(),
    enabled: access.canManage,
  })

  const componentCount = componentsQuery.data
    ? componentsQuery.data.groups.reduce((n, g) => n + g.components.length, 0) +
      componentsQuery.data.ungrouped.length
    : undefined

  function go(next: StatusAdminView) {
    void navigate({ to: '/admin/status', search: { view: next } })
  }

  return (
    <div className="space-y-0 flex flex-col h-full">
      {access.canPublish && (
        <>
          <FilterSection title="Status page">
            <div className="space-y-1">
              <SideItem
                active={view === 'overview'}
                onClick={() => go('overview')}
                icon={SignalIcon}
              >
                Overview
              </SideItem>
            </div>
          </FilterSection>
          <FilterSection title="Incidents">
            <div className="space-y-1">
              <SideItem
                active={view === 'open'}
                onClick={() => go('open')}
                icon={ExclamationTriangleIcon}
                count={openCount}
              >
                Open incidents
              </SideItem>
              <SideItem
                active={view === 'maintenance'}
                icon={CalendarIcon}
                onClick={() => go('maintenance')}
                count={maintenanceCount}
              >
                Scheduled maintenance
              </SideItem>
              <SideItem active={view === 'all'} onClick={() => go('all')} icon={ClockIcon}>
                All incidents
              </SideItem>
            </div>
          </FilterSection>
        </>
      )}

      <FilterSection title="Manage">
        <div className="space-y-1">
          {access.canManage && (
            <SideItem
              active={view === 'components'}
              icon={ServerStackIcon}
              onClick={() => go('components')}
              count={componentCount}
            >
              Services
            </SideItem>
          )}
          {access.canPublish && (
            <SideItem
              active={view === 'templates'}
              onClick={() => go('templates')}
              icon={DocumentTextIcon}
            >
              Templates
            </SideItem>
          )}
          {access.canManage && (
            <SideItem
              active={view === 'subscribers'}
              icon={EnvelopeIcon}
              onClick={() => go('subscribers')}
              count={subscriberCounts.data?.total}
            >
              Subscribers
            </SideItem>
          )}
        </div>
      </FilterSection>
    </div>
  )
}

export function StatusAdmin() {
  const search = Route.useSearch()
  const access = useStatusAccess()
  const fallback = defaultStatusView(access)

  // A role with neither status permission can read none of this.
  if (!fallback) {
    return (
      <div className="flex h-full">
        <StatusNoAccess />
      </div>
    )
  }

  const view: StatusAdminView = search.view ?? fallback

  return (
    <>
      <AdminFilterLayout
        headerTitle="Status"
        filters={<StatusFilterNav view={view} access={access} />}
      >
        {!canOpenStatusView(view, access) ? (
          <StatusNoAccess view={view} />
        ) : (
          <>
            {view === 'overview' && <StatusOverviewView />}
            {view === 'open' && (
              <StatusIncidentList kind="incident" state="active" emptyMessage="No open incidents" />
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
          </>
        )}
      </AdminFilterLayout>

      {/* The editor reads and writes incidents, which is publish's to do. */}
      {access.canPublish && <StatusIncidentModal incidentId={search.incident} />}
    </>
  )
}
