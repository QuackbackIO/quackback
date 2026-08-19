/**
 * Status page admin queries.
 *
 * Query key factories and query options for the Status page product's admin
 * surfaces (incidents/maintenance, components, templates, subscribers,
 * settings) — mirrors the changelog query module's shape.
 */
import { queryOptions, infiniteQueryOptions, keepPreviousData } from '@tanstack/react-query'
import type { StatusComponentId, StatusIncidentId } from '@quackback/ids'
import {
  listStatusComponentsAdminFn,
  listStatusIncidentsAdminFn,
  getStatusIncidentAdminFn,
  getStatusOverviewAdminFn,
  getStatusUptimeAdminFn,
  listStatusIncidentTemplatesFn,
  listStatusSubscriptionsAdminFn,
  getStatusSubscriptionCountsFn,
  getStatusSettingsFn,
  getStatusPageFn,
  getStatusIncidentPublicFn,
  getStatusUptimeFn,
  listStatusHistoryFn,
} from '@/lib/server/functions/status'
import { getMyStatusSubscriptionFn } from '@/lib/server/functions/status-subscriptions'

const STALE_TIME_SHORT = 15 * 1000
const STALE_TIME_MEDIUM = 60 * 1000

export type StatusComponentsAdmin = Awaited<ReturnType<typeof listStatusComponentsAdminFn>>
export type StatusComponentGroupAdmin = StatusComponentsAdmin['groups'][number]
export type StatusComponentAdmin = StatusComponentGroupAdmin['components'][number]

/** List-item shape (the detail fn adds `notifiedSubscriberCount` on top). */
export type StatusIncidentAdmin = Awaited<
  ReturnType<typeof listStatusIncidentsAdminFn>
>['items'][number]
export type StatusIncidentListResult = Awaited<ReturnType<typeof listStatusIncidentsAdminFn>>
export type StatusIncidentAffectedComponent = StatusIncidentAdmin['affectedComponents'][number]
export type StatusIncidentUpdateRow = StatusIncidentAdmin['updates'][number]

export type StatusIncidentTemplate = Awaited<
  ReturnType<typeof listStatusIncidentTemplatesFn>
>[number]

export type StatusSubscriptionListResult = Awaited<
  ReturnType<typeof listStatusSubscriptionsAdminFn>
>
export type StatusSubscriptionAdmin = StatusSubscriptionListResult['items'][number]
export type StatusSubscriptionCounts = Awaited<ReturnType<typeof getStatusSubscriptionCountsFn>>

export interface StatusIncidentListParams {
  kind?: 'incident' | 'maintenance'
  state?: 'active' | 'resolved' | 'all'
  search?: string
}

export const statusKeys = {
  all: ['status'] as const,
  overview: () => [...statusKeys.all, 'overview'] as const,
  components: () => [...statusKeys.all, 'components'] as const,
  incidents: () => [...statusKeys.all, 'incidents'] as const,
  incidentList: (params: StatusIncidentListParams) =>
    [...statusKeys.incidents(), 'list', params] as const,
  incidentDetail: (id: string) => [...statusKeys.incidents(), 'detail', id] as const,
  templates: () => [...statusKeys.all, 'templates'] as const,
  subscribers: () => [...statusKeys.all, 'subscribers'] as const,
  subscriberList: (search?: string) => [...statusKeys.subscribers(), 'list', search] as const,
  subscriberCounts: () => [...statusKeys.subscribers(), 'counts'] as const,
  settings: () => [...statusKeys.all, 'settings'] as const,
  // Public (portal-facing) reads — namespaced under 'public' so they never
  // collide with the admin cache entries above (different serialized shapes).
  public: () => [...statusKeys.all, 'public'] as const,
  publicPage: () => [...statusKeys.public(), 'page'] as const,
  publicIncident: (id: string) => [...statusKeys.public(), 'incident', id] as const,
  publicUptime: (componentIds: string[], windowDays?: number) =>
    [...statusKeys.public(), 'uptime', [...componentIds].sort(), windowDays ?? 90] as const,
  publicHistory: () => [...statusKeys.public(), 'history'] as const,
  mySubscription: () => [...statusKeys.public(), 'my-subscription'] as const,
}

export type StatusUptimeSeriesAdmin = Awaited<ReturnType<typeof getStatusUptimeAdminFn>>[number]
export type StatusUptimeDay = StatusUptimeSeriesAdmin['days'][number]

export const statusComponentQueries = {
  list: () =>
    queryOptions({
      queryKey: statusKeys.components(),
      queryFn: () => listStatusComponentsAdminFn(),
      staleTime: STALE_TIME_SHORT,
    }),

  /** Inline uptime strips in the Services manager. Keyed on the sorted id
   *  set; disabled while empty. */
  uptimeAdmin: (componentIds: string[]) =>
    queryOptions({
      queryKey: [...statusKeys.components(), 'uptime-admin', [...componentIds].sort()] as const,
      queryFn: () => getStatusUptimeAdminFn({ data: { componentIds } }),
      enabled: componentIds.length > 0,
      staleTime: STALE_TIME_MEDIUM,
    }),
}

export type StatusOverview = Awaited<ReturnType<typeof getStatusOverviewAdminFn>>
export type StatusIncidentAdminDetail = Awaited<ReturnType<typeof getStatusIncidentAdminFn>>

export const statusOverviewQueries = {
  get: () =>
    queryOptions({
      queryKey: statusKeys.overview(),
      queryFn: () => getStatusOverviewAdminFn(),
      // The on-call landing view: keep it fresh enough that returning to the
      // tab after an incident-state change shows current truth.
      staleTime: 15 * 1000,
    }),
}

export const statusIncidentQueries = {
  list: (params: StatusIncidentListParams) =>
    infiniteQueryOptions({
      queryKey: statusKeys.incidentList(params),
      queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
        listStatusIncidentsAdminFn({
          data: {
            kind: params.kind,
            state: params.state,
            search: params.search,
            cursor: pageParam,
            limit: 20,
          },
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      // NOTE (QC-2): no `maxPages` — one-directional keyset cursor, no reverse
      // cursor available server-side.
      staleTime: STALE_TIME_SHORT,
      placeholderData: keepPreviousData,
    }),

  detail: (id: string) =>
    queryOptions({
      queryKey: statusKeys.incidentDetail(id),
      queryFn: () => getStatusIncidentAdminFn({ data: { id } }),
      staleTime: STALE_TIME_SHORT,
    }),
}

export const statusTemplateQueries = {
  list: () =>
    queryOptions({
      queryKey: statusKeys.templates(),
      queryFn: () => listStatusIncidentTemplatesFn(),
      staleTime: STALE_TIME_MEDIUM,
    }),
}

export const statusSubscriberQueries = {
  list: (search?: string) =>
    infiniteQueryOptions({
      queryKey: statusKeys.subscriberList(search),
      queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
        listStatusSubscriptionsAdminFn({ data: { cursor: pageParam, limit: 30, search } }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      // NOTE (QC-2): no `maxPages` — one-directional keyset cursor, no reverse
      // cursor available server-side.
      staleTime: STALE_TIME_MEDIUM,
      placeholderData: keepPreviousData,
    }),

  counts: () =>
    queryOptions({
      queryKey: statusKeys.subscriberCounts(),
      queryFn: () => getStatusSubscriptionCountsFn(),
      staleTime: STALE_TIME_MEDIUM,
    }),
}

export const statusSettingsQueries = {
  get: () =>
    queryOptions({
      queryKey: statusKeys.settings(),
      queryFn: () => getStatusSettingsFn(),
      staleTime: STALE_TIME_MEDIUM,
    }),
}

// ============================================================================
// Public (portal) queries — powers routes/_portal/status.index.tsx,
// routes/_portal/status.$incidentId.tsx and components/portal/status/*.
// ============================================================================

/** Full public status page: components, active incidents/maintenance, recent history. */
export const publicStatusPageQueries = {
  get: () =>
    queryOptions({
      queryKey: statusKeys.publicPage(),
      queryFn: () => getStatusPageFn(),
      staleTime: STALE_TIME_SHORT,
    }),
}

/** A single incident/maintenance window (public view). */
export const publicStatusIncidentQueries = {
  detail: (id: StatusIncidentId) =>
    queryOptions({
      queryKey: statusKeys.publicIncident(id),
      queryFn: () => getStatusIncidentPublicFn({ data: { id } }),
      staleTime: STALE_TIME_SHORT,
    }),
}

/** 90-day (default) uptime bars for a set of components. */
export const publicStatusUptimeQueries = {
  list: (componentIds: StatusComponentId[], windowDays?: number) =>
    queryOptions({
      queryKey: statusKeys.publicUptime(componentIds, windowDays),
      queryFn: () => getStatusUptimeFn({ data: { componentIds, windowDays } }),
      enabled: componentIds.length > 0,
      staleTime: STALE_TIME_MEDIUM,
    }),
}

/** Paginated resolved-incident history, for the "Incident history" load-more. */
export const publicStatusHistoryQueries = {
  list: () =>
    infiniteQueryOptions({
      queryKey: statusKeys.publicHistory(),
      queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
        listStatusHistoryFn({ data: { cursor: pageParam, limit: 20 } }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: STALE_TIME_MEDIUM,
    }),
}

/** The caller's own subscription status, for the Subscribe button. */
export const publicStatusSubscriptionQueries = {
  mine: () =>
    queryOptions({
      queryKey: statusKeys.mySubscription(),
      queryFn: () => getMyStatusSubscriptionFn(),
      staleTime: STALE_TIME_SHORT,
    }),
}
