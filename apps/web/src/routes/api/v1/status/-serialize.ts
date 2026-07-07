/**
 * Shared response-serialization helpers for the /api/v1/status/* routes.
 * Not a route itself (the `-` prefix opts it out of file-based routing).
 */
import type {
  StatusComponentRow,
  PublicStatusComponent,
  PublicStatusIncident,
  StatusIncidentWithDetails,
} from '@/lib/server/domains/status'

/** Admin-facing component shape (create/update/get responses). */
export function serializeStatusComponent(row: StatusComponentRow) {
  return {
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    description: row.description,
    status: row.status,
    position: row.position,
    showUptime: row.showUptime,
    segmentIds: row.segmentIds,
  }
}

/** Viewer-facing component shape (the /status/summary snapshot). */
export function serializePublicComponent(component: PublicStatusComponent) {
  return {
    id: component.id,
    name: component.name,
    description: component.description,
    status: component.status,
    showUptime: component.showUptime,
  }
}

/** Viewer-facing incident shape — affected components already filtered to
 *  what the snapshot's actor can see (status.public.ts). */
export function serializePublicIncident(incident: PublicStatusIncident) {
  return {
    id: incident.id,
    kind: incident.kind,
    title: incident.title,
    status: incident.status,
    impact: incident.impact,
    scheduledStartAt: incident.scheduledStartAt?.toISOString() ?? null,
    scheduledEndAt: incident.scheduledEndAt?.toISOString() ?? null,
    startedAt: incident.startedAt.toISOString(),
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    affectedComponents: incident.affectedComponents.map((c) => ({
      id: c.id,
      name: c.name,
      componentStatus: c.componentStatus,
    })),
    updates: incident.updates.map((u) => ({
      id: u.id,
      status: u.status,
      body: u.body,
      createdAt: u.createdAt.toISOString(),
    })),
  }
}

/** Admin (unfiltered) incident shape — full lifecycle detail for the
 *  incidents list/get/create/update-post endpoints. */
export function serializeIncidentDetails(incident: StatusIncidentWithDetails) {
  return {
    id: incident.id,
    kind: incident.kind,
    title: incident.title,
    status: incident.status,
    impact: incident.impact,
    impactOverride: incident.impactOverride,
    scheduledStartAt: incident.scheduledStartAt?.toISOString() ?? null,
    scheduledEndAt: incident.scheduledEndAt?.toISOString() ?? null,
    autoStart: incident.autoStart,
    autoComplete: incident.autoComplete,
    startedAt: incident.startedAt.toISOString(),
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    backfilled: incident.backfilled,
    notifiedAt: incident.notifiedAt?.toISOString() ?? null,
    createdBy: incident.createdBy,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
    affectedComponents: incident.affectedComponents.map((c) => ({
      componentId: c.componentId,
      componentStatus: c.componentStatus,
      name: c.name,
      segmentIds: c.segmentIds,
    })),
    updates: incident.updates.map((u) => ({
      id: u.id,
      status: u.status,
      body: u.body,
      createdBy: u.createdBy,
      createdAt: u.createdAt.toISOString(),
    })),
  }
}
