/**
 * Status-page event declarations (WO-2). Not webhook/workflow-exposed today;
 * the two publish events drive the status-subscription notification path (its
 * own resolver in WO-8), so notification is keyed 'status' for them.
 */
import { decl } from './helpers'

const S = 'status_page'

export const statusIncidentCreated = decl(
  'status.incident_created',
  'status_incident',
  { notification: 'status' },
  S
)
export const statusIncidentUpdated = decl('status.incident_updated', 'status_incident', {}, S)
export const statusMaintenanceScheduled = decl(
  'status.maintenance_scheduled',
  'status_incident',
  { notification: 'status' },
  S
)
export const statusMaintenanceStarted = decl('status.maintenance_started', 'status_incident', {}, S)
export const statusMaintenanceCompleted = decl(
  'status.maintenance_completed',
  'status_incident',
  {},
  S
)
export const statusComponentChanged = decl('status.component_changed', 'status_component', {}, S)
