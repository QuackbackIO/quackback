/**
 * Input/Output types for the Status page domain (Status Product Spec §5-6).
 */
import type {
  StatusComponentId,
  StatusComponentGroupId,
  StatusIncidentId,
  StatusUpdateId,
  StatusSubscriptionId,
  StatusIncidentTemplateId,
  PrincipalId,
  SegmentId,
} from '@quackback/ids'
import type {
  StatusComponentStatus,
  StatusIncidentStatus,
  StatusMaintenanceStatus,
  StatusIncidentKind,
  StatusIncidentImpact,
  StatusComponentEventSource,
  StatusSubscriptionScope,
  StatusSubscriptionSource,
} from '@/lib/server/db'

export type {
  StatusComponentStatus,
  StatusIncidentStatus,
  StatusMaintenanceStatus,
  StatusIncidentKind,
  StatusIncidentImpact,
  StatusComponentEventSource,
  StatusSubscriptionScope,
  StatusSubscriptionSource,
}

// ============================================================================
// Component / group input types
// ============================================================================

export interface CreateStatusComponentGroupInput {
  name: string
  collapsed?: boolean
}

export interface UpdateStatusComponentGroupInput {
  name?: string
  collapsed?: boolean
}

export interface CreateStatusComponentInput {
  name: string
  description?: string | null
  groupId?: StatusComponentGroupId | null
  status?: StatusComponentStatus
  showUptime?: boolean
  segmentIds?: SegmentId[]
}

export interface UpdateStatusComponentInput {
  name?: string
  description?: string | null
  groupId?: StatusComponentGroupId | null
  showUptime?: boolean
  segmentIds?: SegmentId[]
}

export interface StatusComponentGroupWithComponents {
  id: StatusComponentGroupId
  name: string
  position: number
  collapsed: boolean
  components: StatusComponentRow[]
}

export interface StatusComponentRow {
  id: StatusComponentId
  groupId: StatusComponentGroupId | null
  name: string
  description: string | null
  status: StatusComponentStatus
  position: number
  showUptime: boolean
  segmentIds: string[]
}

// ============================================================================
// Incident / maintenance input types
// ============================================================================

/** One affected component and the status to apply to it while the incident is open. */
export interface StatusIncidentComponentInput {
  componentId: StatusComponentId
  componentStatus: StatusComponentStatus
}

/** Creates the incident directly resolved with historical timestamps; applies
 *  no component changes and is never notified (Status Product Spec §2, §5). */
export interface StatusIncidentBackfillInput {
  startedAt: Date
  resolvedAt: Date
}

export interface CreateStatusIncidentInput {
  kind: StatusIncidentKind
  title: string
  /** Initial lifecycle status (incident: investigating|identified|monitoring|resolved;
   *  maintenance: scheduled|in_progress|verifying|completed). */
  status: StatusIncidentStatus | StatusMaintenanceStatus
  /** Ignored for kind='maintenance' (impact is always 'maintenance'). */
  impact?: StatusIncidentImpact
  /** Pins `impact` instead of auto-deriving it from affected components. */
  impactOverride?: boolean
  affectedComponents: StatusIncidentComponentInput[]
  /** Body of the first status_incident_updates row. */
  body: string
  /** Maintenance window bounds. */
  scheduledStartAt?: Date | null
  scheduledEndAt?: Date | null
  autoStart?: boolean
  autoComplete?: boolean
  backfill?: StatusIncidentBackfillInput
  /** Whether the publish claim actually dispatches the subscriber email. Defaults true. */
  notifySubscribers?: boolean
}

export interface UpdateStatusIncidentInput {
  title?: string
  impact?: StatusIncidentImpact
  impactOverride?: boolean
  affectedComponents?: StatusIncidentComponentInput[]
  scheduledStartAt?: Date | null
  scheduledEndAt?: Date | null
  autoStart?: boolean
  autoComplete?: boolean
}

export interface PostIncidentUpdateInput {
  status: StatusIncidentStatus | StatusMaintenanceStatus
  body: string
  /** When the new status is terminal (resolved/completed), skip restoring
   *  affected components to 'operational' (partial-recovery checkbox). */
  skipRestore?: boolean
}

export interface StatusIncidentUpdateRow {
  id: StatusUpdateId
  status: StatusIncidentStatus | StatusMaintenanceStatus
  body: string
  createdBy: PrincipalId | null
  createdAt: Date
}

export interface StatusIncidentAffectedComponent {
  componentId: StatusComponentId
  componentStatus: StatusComponentStatus
  name: string
  segmentIds: string[]
}

export interface StatusIncidentWithDetails {
  id: StatusIncidentId
  kind: StatusIncidentKind
  title: string
  status: StatusIncidentStatus | StatusMaintenanceStatus
  impact: StatusIncidentImpact
  impactOverride: boolean
  scheduledStartAt: Date | null
  scheduledEndAt: Date | null
  autoStart: boolean
  autoComplete: boolean
  startedAt: Date
  resolvedAt: Date | null
  backfilled: boolean
  notifiedAt: Date | null
  createdBy: PrincipalId | null
  createdAt: Date
  updatedAt: Date
  affectedComponents: StatusIncidentAffectedComponent[]
  updates: StatusIncidentUpdateRow[]
}

export interface ListStatusIncidentsParams {
  kind?: StatusIncidentKind
  /** 'active' = not resolved/completed; 'resolved' = resolved/completed. */
  state?: 'active' | 'resolved' | 'all'
  cursor?: string
  limit?: number
}

export interface StatusIncidentListResult {
  items: StatusIncidentWithDetails[]
  nextCursor: string | null
  hasMore: boolean
}

// ============================================================================
// Templates
// ============================================================================

export interface CreateStatusIncidentTemplateInput {
  name: string
  title: string
  body: string
  impact?: StatusIncidentImpact
  componentIds?: StatusComponentId[]
}

export interface UpdateStatusIncidentTemplateInput {
  name?: string
  title?: string
  body?: string
  impact?: StatusIncidentImpact
  componentIds?: StatusComponentId[]
}

export interface StatusIncidentTemplateRow {
  id: StatusIncidentTemplateId
  name: string
  title: string
  body: string
  impact: StatusIncidentImpact
  componentIds: StatusComponentId[]
}

// ============================================================================
// Subscriptions
// ============================================================================

export interface StatusSubscriptionStatus {
  principalId: PrincipalId
  subscribed: boolean
  scope: StatusSubscriptionScope
  componentIds: StatusComponentId[]
  source: StatusSubscriptionSource | null
  unsubscribedAt: Date | null
}

export interface StatusSubscriptionAdminRow {
  id: StatusSubscriptionId
  principalId: PrincipalId
  displayName: string | null
  email: string | null
  scope: StatusSubscriptionScope
  componentIds: StatusComponentId[]
  source: StatusSubscriptionSource
  unsubscribedAt: Date | null
  createdAt: Date
}

export interface StatusSubscriptionListResult {
  items: StatusSubscriptionAdminRow[]
  nextCursor: string | null
  hasMore: boolean
}

export interface StatusSubscriptionCounts {
  total: number
  active: number
  unsubscribed: number
}

// ============================================================================
// Viewer-facing (public) shapes
// ============================================================================

export interface PublicStatusComponent {
  id: StatusComponentId
  name: string
  description: string | null
  status: StatusComponentStatus
  showUptime: boolean
}

export interface PublicStatusComponentGroup {
  id: StatusComponentGroupId
  name: string
  collapsed: boolean
  components: PublicStatusComponent[]
}

export interface PublicStatusIncidentUpdate {
  id: StatusUpdateId
  status: StatusIncidentStatus | StatusMaintenanceStatus
  body: string
  createdAt: Date
}

/** Affected-components list is filtered to what THIS viewer can see — see
 *  Status Product Spec §4 (an incident hidden component must not leak here). */
export interface PublicStatusIncident {
  id: StatusIncidentId
  kind: StatusIncidentKind
  title: string
  status: StatusIncidentStatus | StatusMaintenanceStatus
  impact: StatusIncidentImpact
  scheduledStartAt: Date | null
  scheduledEndAt: Date | null
  startedAt: Date
  resolvedAt: Date | null
  affectedComponents: Array<{
    id: StatusComponentId
    name: string
    componentStatus: StatusComponentStatus
  }>
  updates: PublicStatusIncidentUpdate[]
}

export interface StatusDayGroup {
  /** UTC day, `YYYY-MM-DD`. */
  date: string
  incidents: PublicStatusIncident[]
}

export interface StatusPageTopLevel {
  /** Banner status — worst-of over the viewer's visible components (§2, §5). */
  status: StatusComponentStatus
  /** Same derivation as `status` today; kept as a distinct field for a future
   *  override (e.g. a manually-pinned banner) without an API shape change. */
  worstComponentStatus: StatusComponentStatus
  activeIncidentCount: number
}

export interface StatusPageSnapshot {
  topLevel: StatusPageTopLevel
  groups: PublicStatusComponentGroup[]
  ungroupedComponents: PublicStatusComponent[]
  activeIncidents: PublicStatusIncident[]
  upcomingMaintenance: PublicStatusIncident[]
  recentIncidents: StatusDayGroup[]
}

export interface UptimeDay {
  /** UTC day, `YYYY-MM-DD`. */
  date: string
  worstStatus: StatusComponentStatus
  /** 0-100, rounded to 2 decimal places. */
  uptimePct: number
}

export interface UptimeSeries {
  componentId: StatusComponentId
  days: UptimeDay[]
}

export interface IncidentHistoryParams {
  cursor?: string
  limit?: number
}

export interface IncidentHistoryResult {
  items: PublicStatusIncident[]
  nextCursor: string | null
  hasMore: boolean
}
