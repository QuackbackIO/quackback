/**
 * Status page domain barrel.
 *
 * Import service functions directly:
 *   - './status.service' for incident/maintenance lifecycle + templates
 *   - './status.components' for component/group CRUD + manual status writes
 *   - './status.maintenance' for scheduled-window automation
 *   - './status.audience' for the Layer-1 page gate
 *   - './status.public' for viewer-scoped reads
 *   - './status.subscription' for the subscriber pipeline
 *   - './status.calc' for pure derivations (unit-testable, no DB)
 */
export type {
  StatusComponentStatus,
  StatusIncidentStatus,
  StatusMaintenanceStatus,
  StatusIncidentKind,
  StatusIncidentImpact,
  StatusComponentEventSource,
  StatusSubscriptionScope,
  StatusSubscriptionSource,
  CreateStatusComponentGroupInput,
  UpdateStatusComponentGroupInput,
  CreateStatusComponentInput,
  UpdateStatusComponentInput,
  StatusComponentGroupWithComponents,
  StatusComponentRow,
  StatusIncidentComponentInput,
  StatusIncidentBackfillInput,
  CreateStatusIncidentInput,
  UpdateStatusIncidentInput,
  PostIncidentUpdateInput,
  StatusIncidentUpdateRow,
  StatusIncidentAffectedComponent,
  StatusIncidentWithDetails,
  ListStatusIncidentsParams,
  StatusIncidentListResult,
  CreateStatusIncidentTemplateInput,
  UpdateStatusIncidentTemplateInput,
  StatusIncidentTemplateRow,
  StatusSubscriptionStatus,
  StatusSubscriptionAdminRow,
  StatusSubscriptionListResult,
  StatusSubscriptionCounts,
  PublicStatusComponent,
  PublicStatusComponentGroup,
  PublicStatusIncidentUpdate,
  PublicStatusIncident,
  StatusDayGroup,
  StatusPageTopLevel,
  StatusPageSnapshot,
  UptimeDay,
  UptimeSeries,
  IncidentHistoryParams,
  IncidentHistoryResult,
} from './status.types'

export {
  deriveTopLevelStatus,
  deriveImpact,
  deriveUptimeDays,
  type UptimeStatusEvent,
} from './status.calc'

export {
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
  dispatchStatusEvent,
  type StatusEventType,
} from './status.components'

export {
  createIncident,
  updateIncident,
  postIncidentUpdate,
  deleteIncident,
  clearStatusHistory,
  getStatusIncidentById,
  listStatusIncidents,
  notifyStatusIncidentPublished,
  reconcileStatusNotifications,
  listStatusIncidentTemplates,
  createStatusIncidentTemplate,
  updateStatusIncidentTemplate,
  deleteStatusIncidentTemplate,
} from './status.service'

export {
  enqueueMaintenanceJobs,
  cancelMaintenanceJobs,
  handleMaintenanceStart,
  handleMaintenanceComplete,
  reconcileMaintenanceWindows,
} from './status.maintenance'

export { isStatusAudienceGranted } from './status.audience'

export {
  getStatusPageSnapshot,
  getPublicStatusIncident,
  getUptimeSeries,
  listIncidentHistory,
} from './status.public'

export {
  subscribe,
  unsubscribe,
  resubscribe,
  getMySubscription,
  listStatusSubscriptions,
  getStatusSubscriptionCounts,
  getActiveSubscribersForComponents,
} from './status.subscription'
