/**
 * Server Functions for the Status Page product (Status Product Spec).
 *
 * Thin TanStack Start wrappers over the status domain
 * (`domains/status/index.ts`) — mirrors changelog.ts's structure: admin
 * mutations gated by permission, public reads gated by portal access + the
 * status audience ladder (§4) + the `statusPage` feature flag.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type {
  StatusComponentId,
  StatusComponentGroupId,
  StatusIncidentId,
  StatusIncidentTemplateId,
  SegmentId,
} from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth, getOptionalAuth, policyActorFromAuth } from './auth-helpers'
import { resolvePortalAccessForRequest } from './portal-access'
import {
  createStatusComponentGroup,
  updateStatusComponentGroup,
  deleteStatusComponentGroup,
  reorderStatusComponentGroups,
  listStatusComponentGroupsWithComponents,
  listUngroupedStatusComponents,
  createStatusComponent,
  updateStatusComponent,
  deleteStatusComponent,
  reorderStatusComponents,
  setComponentStatus,
  createIncident,
  updateIncident,
  postIncidentUpdate,
  deleteIncident,
  clearStatusHistory,
  getStatusIncidentById,
  listStatusIncidents,
  countStatusIncidentsSince,
  countStatusSubscriptionsSince,
  startMaintenanceNow,
  deriveTopLevelStatus,
  listStatusIncidentTemplates,
  createStatusIncidentTemplate,
  updateStatusIncidentTemplate,
  deleteStatusIncidentTemplate,
  listStatusSubscriptions,
  getStatusSubscriptionCounts,
  countActiveSubscribersForComponents,
  isStatusAudienceGranted,
  getStatusPageSnapshot,
  getPublicStatusIncident,
  getUptimeSeries,
  listIncidentHistory,
} from '@/lib/server/domains/status'
import type {
  StatusIncidentWithDetails,
  PublicStatusIncident,
  StatusPageSnapshot,
} from '@/lib/server/domains/status'
import {
  getStatusSettings,
  updateStatusSettings,
} from '@/lib/server/domains/settings/settings.status'
import { enforceStatusComponentLimit } from '@/lib/server/domains/settings/tier-enforce'
import {
  statusSettingsSchema,
  DEFAULT_STATUS_SETTINGS,
  type StatusSettings,
} from '@/lib/shared/status-settings'
import type { Actor } from '@/lib/server/policy/types'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'status' })

// ============================================================================
// Shared enums / serialization helpers
// ============================================================================

const componentStatusEnum = z.enum([
  'operational',
  'degraded_performance',
  'partial_outage',
  'major_outage',
  'under_maintenance',
])

const incidentOrMaintenanceStatusEnum = z.enum([
  'investigating',
  'identified',
  'monitoring',
  'resolved',
  'scheduled',
  'in_progress',
  'verifying',
  'completed',
])

const incidentKindEnum = z.enum(['incident', 'maintenance'])
const incidentImpactEnum = z.enum(['none', 'minor', 'major', 'critical', 'maintenance'])

function serializeIncident(incident: StatusIncidentWithDetails) {
  return {
    ...incident,
    scheduledStartAt: toIsoStringOrNull(incident.scheduledStartAt),
    scheduledEndAt: toIsoStringOrNull(incident.scheduledEndAt),
    startedAt: toIsoString(incident.startedAt),
    resolvedAt: toIsoStringOrNull(incident.resolvedAt),
    notifiedAt: toIsoStringOrNull(incident.notifiedAt),
    createdAt: toIsoString(incident.createdAt),
    updatedAt: toIsoString(incident.updatedAt),
    updates: incident.updates.map((u) => ({ ...u, createdAt: toIsoString(u.createdAt) })),
  }
}

function serializePublicIncident(incident: PublicStatusIncident) {
  return {
    ...incident,
    scheduledStartAt: toIsoStringOrNull(incident.scheduledStartAt),
    scheduledEndAt: toIsoStringOrNull(incident.scheduledEndAt),
    startedAt: toIsoString(incident.startedAt),
    resolvedAt: toIsoStringOrNull(incident.resolvedAt),
    updates: incident.updates.map((u) => ({ ...u, createdAt: toIsoString(u.createdAt) })),
  }
}

function serializeSnapshot(snapshot: StatusPageSnapshot) {
  return {
    ...snapshot,
    activeIncidents: snapshot.activeIncidents.map(serializePublicIncident),
    upcomingMaintenance: snapshot.upcomingMaintenance.map(serializePublicIncident),
    recentIncidents: snapshot.recentIncidents.map((day) => ({
      ...day,
      incidents: day.incidents.map(serializePublicIncident),
    })),
  }
}

// ============================================================================
// Admin: Components / Groups (gate: STATUS_PAGE_MANAGE)
// ============================================================================

export const listStatusComponentsAdminFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
    const [groups, ungrouped] = await Promise.all([
      listStatusComponentGroupsWithComponents(),
      listUngroupedStatusComponents(),
    ])
    return { groups, ungrouped }
  } catch (error) {
    log.error({ err: error }, 'list status components admin failed')
    throw error
  }
})

const createStatusComponentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  status: componentStatusEnum.optional(),
  showUptime: z.boolean().optional(),
  segmentIds: z.array(z.string()).optional(),
})

export const createStatusComponentFn = createServerFn({ method: 'POST' })
  .validator(createStatusComponentSchema)
  .handler(async ({ data }) => {
    log.debug({ name: data.name }, 'create status component')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      await enforceStatusComponentLimit()
      return await createStatusComponent({
        name: data.name,
        description: data.description ?? null,
        groupId: (data.groupId ?? null) as StatusComponentGroupId | null,
        status: data.status,
        showUptime: data.showUptime,
        segmentIds: data.segmentIds as SegmentId[] | undefined,
      })
    } catch (error) {
      log.error({ err: error }, 'create status component failed')
      throw error
    }
  })

const updateStatusComponentSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  showUptime: z.boolean().optional(),
  segmentIds: z.array(z.string()).optional(),
})

export const updateStatusComponentFn = createServerFn({ method: 'POST' })
  .validator(updateStatusComponentSchema)
  .handler(async ({ data }) => {
    log.debug({ component_id: data.id }, 'update status component')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      return await updateStatusComponent(data.id as StatusComponentId, {
        name: data.name,
        description: data.description,
        groupId:
          data.groupId === undefined ? undefined : (data.groupId as StatusComponentGroupId | null),
        showUptime: data.showUptime,
        segmentIds: data.segmentIds as SegmentId[] | undefined,
      })
    } catch (error) {
      log.error({ err: error }, 'update status component failed')
      throw error
    }
  })

const idSchema = z.object({ id: z.string() })
const reorderIdsSchema = z.object({ ids: z.array(z.string()).min(1) })

export const deleteStatusComponentFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.debug({ component_id: data.id }, 'delete status component')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      await deleteStatusComponent(data.id as StatusComponentId)
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'delete status component failed')
      throw error
    }
  })

export const reorderStatusComponentsFn = createServerFn({ method: 'POST' })
  .validator(reorderIdsSchema)
  .handler(async ({ data }) => {
    log.debug({ count: data.ids.length }, 'reorder status components')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      await reorderStatusComponents(data.ids as StatusComponentId[])
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'reorder status components failed')
      throw error
    }
  })

const setStatusComponentStatusSchema = z.object({
  id: z.string(),
  status: componentStatusEnum,
})

export const setStatusComponentStatusFn = createServerFn({ method: 'POST' })
  .validator(setStatusComponentStatusSchema)
  .handler(async ({ data }) => {
    log.debug({ component_id: data.id, status: data.status }, 'set status component status')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      await setComponentStatus(data.id as StatusComponentId, data.status, 'manual')
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'set status component status failed')
      throw error
    }
  })

const createStatusGroupSchema = z.object({
  name: z.string().min(1).max(200),
  collapsed: z.boolean().optional(),
})

export const createStatusGroupFn = createServerFn({ method: 'POST' })
  .validator(createStatusGroupSchema)
  .handler(async ({ data }) => {
    log.debug({ name: data.name }, 'create status group')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      return await createStatusComponentGroup({ name: data.name, collapsed: data.collapsed })
    } catch (error) {
      log.error({ err: error }, 'create status group failed')
      throw error
    }
  })

const updateStatusGroupSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200).optional(),
  collapsed: z.boolean().optional(),
})

export const updateStatusGroupFn = createServerFn({ method: 'POST' })
  .validator(updateStatusGroupSchema)
  .handler(async ({ data }) => {
    log.debug({ group_id: data.id }, 'update status group')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      await updateStatusComponentGroup(data.id as StatusComponentGroupId, {
        name: data.name,
        collapsed: data.collapsed,
      })
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'update status group failed')
      throw error
    }
  })

export const deleteStatusGroupFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.debug({ group_id: data.id }, 'delete status group')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      await deleteStatusComponentGroup(data.id as StatusComponentGroupId)
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'delete status group failed')
      throw error
    }
  })

export const reorderStatusGroupsFn = createServerFn({ method: 'POST' })
  .validator(reorderIdsSchema)
  .handler(async ({ data }) => {
    log.debug({ count: data.ids.length }, 'reorder status groups')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      await reorderStatusComponentGroups(data.ids as StatusComponentGroupId[])
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'reorder status groups failed')
      throw error
    }
  })

// ============================================================================
// Admin: Incidents / Maintenance (gate: STATUS_PAGE_PUBLISH)
// ============================================================================

const affectedComponentSchema = z.object({
  componentId: z.string(),
  componentStatus: componentStatusEnum,
})

const createStatusIncidentSchema = z.object({
  kind: incidentKindEnum,
  title: z.string().min(1).max(200),
  status: incidentOrMaintenanceStatusEnum,
  impact: incidentImpactEnum.optional(),
  impactOverride: z.boolean().optional(),
  affectedComponents: z.array(affectedComponentSchema).min(1),
  body: z.string().min(1),
  scheduledStartAt: z.coerce.date().nullable().optional(),
  scheduledEndAt: z.coerce.date().nullable().optional(),
  autoStart: z.boolean().optional(),
  autoComplete: z.boolean().optional(),
  backfill: z.object({ startedAt: z.coerce.date(), resolvedAt: z.coerce.date() }).optional(),
  notifySubscribers: z.boolean().optional(),
})

export const createStatusIncidentFn = createServerFn({ method: 'POST' })
  .validator(createStatusIncidentSchema)
  .handler(async ({ data }) => {
    log.debug({ kind: data.kind, title: data.title }, 'create status incident')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_PUBLISH })
      const incident = await createIncident(
        {
          kind: data.kind,
          title: data.title,
          status: data.status,
          impact: data.impact,
          impactOverride: data.impactOverride,
          affectedComponents: data.affectedComponents.map((c) => ({
            componentId: c.componentId as StatusComponentId,
            componentStatus: c.componentStatus,
          })),
          body: data.body,
          scheduledStartAt: data.scheduledStartAt,
          scheduledEndAt: data.scheduledEndAt,
          autoStart: data.autoStart,
          autoComplete: data.autoComplete,
          backfill: data.backfill,
          notifySubscribers: data.notifySubscribers,
        },
        { principalId: auth.principal.id }
      )
      return serializeIncident(incident)
    } catch (error) {
      log.error({ err: error }, 'create status incident failed')
      throw error
    }
  })

const updateStatusIncidentSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  impact: incidentImpactEnum.optional(),
  impactOverride: z.boolean().optional(),
  affectedComponents: z.array(affectedComponentSchema).optional(),
  scheduledStartAt: z.coerce.date().nullable().optional(),
  scheduledEndAt: z.coerce.date().nullable().optional(),
  autoStart: z.boolean().optional(),
  autoComplete: z.boolean().optional(),
})

export const updateStatusIncidentFn = createServerFn({ method: 'POST' })
  .validator(updateStatusIncidentSchema)
  .handler(async ({ data }) => {
    log.debug({ incident_id: data.id }, 'update status incident')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_PUBLISH })
      const incident = await updateIncident(data.id as StatusIncidentId, {
        title: data.title,
        impact: data.impact,
        impactOverride: data.impactOverride,
        affectedComponents: data.affectedComponents?.map((c) => ({
          componentId: c.componentId as StatusComponentId,
          componentStatus: c.componentStatus,
        })),
        scheduledStartAt: data.scheduledStartAt,
        scheduledEndAt: data.scheduledEndAt,
        autoStart: data.autoStart,
        autoComplete: data.autoComplete,
      })
      return serializeIncident(incident)
    } catch (error) {
      log.error({ err: error }, 'update status incident failed')
      throw error
    }
  })

const postStatusIncidentUpdateSchema = z.object({
  id: z.string(),
  status: incidentOrMaintenanceStatusEnum,
  body: z.string().min(1),
  skipRestore: z.boolean().optional(),
})

export const postStatusIncidentUpdateFn = createServerFn({ method: 'POST' })
  .validator(postStatusIncidentUpdateSchema)
  .handler(async ({ data }) => {
    log.debug({ incident_id: data.id, status: data.status }, 'post status incident update')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_PUBLISH })
      const incident = await postIncidentUpdate(
        data.id as StatusIncidentId,
        { status: data.status, body: data.body, skipRestore: data.skipRestore },
        { principalId: auth.principal.id }
      )
      return serializeIncident(incident)
    } catch (error) {
      log.error({ err: error }, 'post status incident update failed')
      throw error
    }
  })

export const deleteStatusIncidentFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.debug({ incident_id: data.id }, 'delete status incident')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_PUBLISH })
      await deleteIncident(data.id as StatusIncidentId)
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'delete status incident failed')
      throw error
    }
  })

/** Danger-zone reset: clears resolved incidents + uptime history (Status
 *  Product Spec §8). Gated on STATUS_PAGE_MANAGE — reshaping the page, not
 *  posting to it. */
export const clearStatusHistoryFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.info('clear status history')
  try {
    await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
    return await clearStatusHistory()
  } catch (error) {
    log.error({ err: error }, 'clear status history failed')
    throw error
  }
})

export const getStatusIncidentAdminFn = createServerFn({ method: 'GET' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.debug({ incident_id: data.id }, 'get status incident admin')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_PUBLISH })
      const incident = await getStatusIncidentById(data.id as StatusIncidentId)

      // Approximate "emailed N subscribers" for the editor's publish marker.
      // The recipient count is not persisted at publish time (the claim only
      // writes notified_at), so this is the CURRENT active pool for the
      // affected components — the editor copy hedges accordingly ("~N").
      let notifiedSubscriberCount: number | null = null
      if (incident.notifiedAt && !incident.backfilled) {
        notifiedSubscriberCount = await countActiveSubscribersForComponents(
          incident.affectedComponents.map((c) => c.componentId)
        )
      }

      return { ...serializeIncident(incident), notifiedSubscriberCount }
    } catch (error) {
      log.error({ err: error }, 'get status incident admin failed')
      throw error
    }
  })

const listStatusIncidentsAdminSchema = z.object({
  kind: incidentKindEnum.optional(),
  state: z.enum(['active', 'resolved', 'all']).optional(),
  search: z.string().trim().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
})

export const listStatusIncidentsAdminFn = createServerFn({ method: 'GET' })
  .validator(listStatusIncidentsAdminSchema)
  .handler(async ({ data }) => {
    log.debug({ kind: data.kind, state: data.state }, 'list status incidents admin')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_PUBLISH })
      const result = await listStatusIncidents({
        kind: data.kind,
        state: data.state,
        search: data.search,
        cursor: data.cursor,
        limit: data.limit,
      })
      return { ...result, items: result.items.map(serializeIncident) }
    } catch (error) {
      log.error({ err: error }, 'list status incidents admin failed')
      throw error
    }
  })

// ============================================================================
// Admin: Overview + maintenance start-now (gate: STATUS_PAGE_PUBLISH — the
// on-call landing surfaces; the floor permission of anyone running incidents)
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Everything the admin Overview needs in one round trip: the derived
 * public-banner state, service health, active incidents, upcoming
 * maintenance, and the stat tiles. Deliberately NOT the viewer-scoped
 * `getStatusPageSnapshot`/`getStatusUptimeFn` path — those 404/empty when
 * `statusSettings.enabled` is false, and admins need the overview precisely
 * to see and fix a disabled page.
 */
export const getStatusOverviewAdminFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const auth = await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_PUBLISH })
    const now = new Date()

    const [
      groups,
      ungrouped,
      incidents,
      maintenance,
      counts,
      newLast7d,
      incidentsLast30d,
      settings,
    ] = await Promise.all([
      listStatusComponentGroupsWithComponents(),
      listUngroupedStatusComponents(),
      listStatusIncidents({ kind: 'incident', state: 'active', limit: 20 }),
      listStatusIncidents({ kind: 'maintenance', state: 'active', limit: 20 }),
      getStatusSubscriptionCounts(),
      countStatusSubscriptionsSince(new Date(now.getTime() - 7 * DAY_MS)),
      countStatusIncidentsSince(new Date(now.getTime() - 30 * DAY_MS)),
      getStatusSettings(),
    ])

    const leanComponent = (c: { id: string; name: string; status: string }) => ({
      id: c.id,
      name: c.name,
      status: c.status,
    })
    const allComponents = [...ungrouped, ...groups.flatMap((g) => g.components)]

    // Uptime via a policy actor for the authed admin (team actors bypass
    // segment gates, so this sees every component).
    const actor = await policyActorFromAuth(auth)
    const uptime =
      allComponents.length > 0
        ? await getUptimeSeries(
            actor,
            allComponents.map((c) => c.id),
            90
          )
        : []
    const allDays = uptime.flatMap((s) => s.days)
    const uptime90d =
      allDays.length > 0 ? allDays.reduce((sum, d) => sum + d.uptimePct, 0) / allDays.length : null

    return {
      enabled: settings.enabled,
      topLevelStatus: deriveTopLevelStatus(allComponents.map((c) => c.status)),
      ungroupedComponents: ungrouped.map(leanComponent),
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        components: g.components.map(leanComponent),
      })),
      activeIncidents: incidents.items.map(serializeIncident),
      upcomingMaintenance: maintenance.items
        .slice()
        .sort(
          (a, b) =>
            (a.scheduledStartAt?.getTime() ?? Infinity) -
            (b.scheduledStartAt?.getTime() ?? Infinity)
        )
        .map(serializeIncident),
      uptime90d,
      subscribers: { ...counts, newLast7d },
      incidentsLast30d,
    }
  } catch (error) {
    log.error({ err: error }, 'get status overview admin failed')
    throw error
  }
})

/** Start a scheduled maintenance window immediately (pulls the start bound to
 *  now so component statuses apply and the auto-complete job reschedules). */
export const startStatusMaintenanceNowFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.debug({ incident_id: data.id }, 'start status maintenance now')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_PUBLISH })
      await startMaintenanceNow(data.id as StatusIncidentId)
      const incident = await getStatusIncidentById(data.id as StatusIncidentId)
      return serializeIncident(incident)
    } catch (error) {
      log.error({ err: error }, 'start status maintenance now failed')
      throw error
    }
  })

// ============================================================================
// Admin: Templates (list gate: STATUS_PAGE_PUBLISH — the incident composer's
// template picker is contributor territory; CRUD stays STATUS_PAGE_MANAGE)
// ============================================================================

export const listStatusIncidentTemplatesFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_PUBLISH })
    return await listStatusIncidentTemplates()
  } catch (error) {
    log.error({ err: error }, 'list status incident templates failed')
    throw error
  }
})

const createStatusTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  impact: incidentImpactEnum.optional(),
  componentIds: z.array(z.string()).optional(),
})

export const createStatusIncidentTemplateFn = createServerFn({ method: 'POST' })
  .validator(createStatusTemplateSchema)
  .handler(async ({ data }) => {
    log.debug({ name: data.name }, 'create status incident template')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      return await createStatusIncidentTemplate({
        name: data.name,
        title: data.title,
        body: data.body,
        impact: data.impact,
        componentIds: data.componentIds as StatusComponentId[] | undefined,
      })
    } catch (error) {
      log.error({ err: error }, 'create status incident template failed')
      throw error
    }
  })

const updateStatusTemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).optional(),
  impact: incidentImpactEnum.optional(),
  componentIds: z.array(z.string()).optional(),
})

export const updateStatusIncidentTemplateFn = createServerFn({ method: 'POST' })
  .validator(updateStatusTemplateSchema)
  .handler(async ({ data }) => {
    log.debug({ template_id: data.id }, 'update status incident template')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      return await updateStatusIncidentTemplate(data.id as StatusIncidentTemplateId, {
        name: data.name,
        title: data.title,
        body: data.body,
        impact: data.impact,
        componentIds: data.componentIds as StatusComponentId[] | undefined,
      })
    } catch (error) {
      log.error({ err: error }, 'update status incident template failed')
      throw error
    }
  })

export const deleteStatusIncidentTemplateFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.debug({ template_id: data.id }, 'delete status incident template')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      await deleteStatusIncidentTemplate(data.id as StatusIncidentTemplateId)
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'delete status incident template failed')
      throw error
    }
  })

// ============================================================================
// Admin: Subscribers (gate: STATUS_PAGE_MANAGE)
// ============================================================================

const listStatusSubscriptionsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
})

export const listStatusSubscriptionsAdminFn = createServerFn({ method: 'GET' })
  .validator(listStatusSubscriptionsSchema)
  .handler(async ({ data }) => {
    log.debug({ cursor: data.cursor, limit: data.limit }, 'list status subscriptions admin')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      const result = await listStatusSubscriptions({ cursor: data.cursor, limit: data.limit })
      return {
        ...result,
        items: result.items.map((item) => ({
          ...item,
          createdAt: toIsoString(item.createdAt),
          unsubscribedAt: toIsoStringOrNull(item.unsubscribedAt),
        })),
      }
    } catch (error) {
      log.error({ err: error }, 'list status subscriptions admin failed')
      throw error
    }
  })

export const getStatusSubscriptionCountsFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
    return await getStatusSubscriptionCounts()
  } catch (error) {
    log.error({ err: error }, 'get status subscription counts failed')
    throw error
  }
})

// ============================================================================
// Admin: Settings (gate: STATUS_PAGE_MANAGE)
// ============================================================================

export const getStatusSettingsFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
    return await getStatusSettings()
  } catch (error) {
    log.error({ err: error }, 'get status settings failed')
    throw error
  }
})

export const updateStatusSettingsFn = createServerFn({ method: 'POST' })
  .validator(statusSettingsSchema)
  .handler(async ({ data }) => {
    log.debug(data, 'update status settings')
    try {
      await requireAuth({ permission: PERMISSIONS.STATUS_PAGE_MANAGE })
      return await updateStatusSettings(data)
    } catch (error) {
      log.error({ err: error }, 'update status settings failed')
      throw error
    }
  })

// ============================================================================
// Public Server Functions (viewer-scoped)
// ============================================================================

interface StatusPageGateResult {
  available: boolean
  actor: Actor
  settings: StatusSettings
}

/**
 * Composes every gate the public status surfaces must pass, in order:
 *
 *   1. Portal access (a private portal must not leak status data to a caller
 *      the portal-access resolver denies — same outer gate as changelog).
 *   2. `statusSettings.enabled` — the workspace's own master switch.
 *   3. The `statusPage` feature flag.
 *   4. The status audience ladder (§4): public / authenticated / segments.
 *
 * Never throws; callers translate `available: false` into the shape their
 * endpoint contract expects (404 for a single-entity read, empty list/array
 * for a collection read) — mirrors `getPublicChangelogFn` / `listPublicChangelogsFn`.
 */
async function resolveStatusPageGate(): Promise<StatusPageGateResult> {
  const access = await resolvePortalAccessForRequest()
  if (!access.granted) {
    return { available: false, actor: ANONYMOUS_ACTOR, settings: DEFAULT_STATUS_SETTINGS }
  }

  const settings = await getStatusSettings()
  const authCtx = await getOptionalAuth()
  const actor = await policyActorFromAuth(authCtx)

  if (!settings.enabled) {
    return { available: false, actor, settings }
  }

  const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
  if (!(await isFeatureEnabled('statusPage'))) {
    return { available: false, actor, settings }
  }

  if (!isStatusAudienceGranted(actor, settings)) {
    return { available: false, actor, settings }
  }

  return { available: true, actor, settings }
}

/** Full public status page: component tree, active incidents/maintenance,
 *  and recent history — gated per `resolveStatusPageGate`. */
export const getStatusPageFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const gate = await resolveStatusPageGate()
    if (!gate.available) {
      throw new NotFoundError('STATUS_PAGE_NOT_FOUND', 'Status page not found')
    }

    const snapshot = await getStatusPageSnapshot(gate.actor, gate.settings)

    // Uptime bars ship in the page payload (not a separate client fetch): the
    // series is small (90 days × visible components), so folding it in here
    // SSRs the bars with no request waterfall and no client-side flash.
    const uptimeComponentIds = [
      ...snapshot.ungroupedComponents,
      ...snapshot.groups.flatMap((g) => g.components),
    ]
      .filter((c) => c.showUptime)
      .map((c) => c.id)
    const uptime = uptimeComponentIds.length
      ? await getUptimeSeries(gate.actor, uptimeComponentIds)
      : []

    return {
      snapshot: serializeSnapshot(snapshot),
      settings: {
        pageDescription: gate.settings.pageDescription,
        audience: gate.settings.audience,
      },
      uptime,
    }
  } catch (error) {
    log.error({ err: error }, 'get status page failed')
    throw error
  }
})

const getStatusIncidentPublicSchema = z.object({ id: z.string() })

/** A single incident/maintenance window (public view) — 404s the same way
 *  for "gated out" and "genuinely missing" (Status Product Spec §4). */
export const getStatusIncidentPublicFn = createServerFn({ method: 'GET' })
  .validator(getStatusIncidentPublicSchema)
  .handler(async ({ data }) => {
    try {
      const gate = await resolveStatusPageGate()
      if (!gate.available) {
        throw new NotFoundError('STATUS_INCIDENT_NOT_FOUND', `Status incident ${data.id} not found`)
      }

      const incident = await getPublicStatusIncident(gate.actor, data.id as StatusIncidentId)
      if (!incident) {
        throw new NotFoundError('STATUS_INCIDENT_NOT_FOUND', `Status incident ${data.id} not found`)
      }

      return serializePublicIncident(incident)
    } catch (error) {
      log.error({ err: error }, 'get status incident public failed')
      throw error
    }
  })

const getStatusUptimeSchema = z.object({
  componentIds: z.array(z.string()).min(1),
  windowDays: z.number().int().positive().max(365).optional(),
})

/** Uptime bars for a set of components — returns an empty array (not an
 *  error) when the page is gated out, matching `listPublicChangelogsFn`. */
export const getStatusUptimeFn = createServerFn({ method: 'GET' })
  .validator(getStatusUptimeSchema)
  .handler(async ({ data }) => {
    try {
      const gate = await resolveStatusPageGate()
      if (!gate.available) return []

      return await getUptimeSeries(
        gate.actor,
        data.componentIds as StatusComponentId[],
        data.windowDays
      )
    } catch (error) {
      log.error({ err: error }, 'get status uptime failed')
      throw error
    }
  })

const listStatusHistorySchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
})

/** Paginated resolved-incident history (public view). */
export const listStatusHistoryFn = createServerFn({ method: 'GET' })
  .validator(listStatusHistorySchema)
  .handler(async ({ data }) => {
    try {
      const gate = await resolveStatusPageGate()
      if (!gate.available) {
        return { items: [], nextCursor: null, hasMore: false }
      }

      const result = await listIncidentHistory(gate.actor, {
        cursor: data.cursor,
        limit: data.limit,
      })
      return { ...result, items: result.items.map(serializePublicIncident) }
    } catch (error) {
      log.error({ err: error }, 'list status history failed')
      throw error
    }
  })
