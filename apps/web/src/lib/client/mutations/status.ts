/**
 * Status page admin mutations.
 *
 * Mutation hooks for the Status page product's admin surfaces — mirrors the
 * changelog mutations module's shape (invalidate-on-success, no optimistic
 * cache writes beyond what the callers already do locally).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createStatusComponentFn,
  updateStatusComponentFn,
  deleteStatusComponentFn,
  reorderStatusComponentsFn,
  setStatusComponentStatusFn,
  createStatusGroupFn,
  updateStatusGroupFn,
  deleteStatusGroupFn,
  reorderStatusGroupsFn,
  createStatusIncidentFn,
  updateStatusIncidentFn,
  postStatusIncidentUpdateFn,
  deleteStatusIncidentFn,
  startStatusMaintenanceNowFn,
  clearStatusHistoryFn,
  createStatusIncidentTemplateFn,
  updateStatusIncidentTemplateFn,
  deleteStatusIncidentTemplateFn,
  updateStatusSettingsFn,
} from '@/lib/server/functions/status'
import { statusKeys } from '@/lib/client/queries/status'
import type { UpdateStatusSettingsInput } from '@/lib/shared/status-settings'

/** Merge a mutation response into the incident-detail cache. Merge, don't
 *  replace: the detail read carries fields (e.g. notifiedSubscriberCount)
 *  the mutation responses don't return. */
function mergeIncidentDetail(queryClient: ReturnType<typeof useQueryClient>, data: { id: string }) {
  queryClient.setQueryData(statusKeys.incidentDetail(data.id), (prev: object | undefined) =>
    prev ? { ...prev, ...data } : data
  )
}

// ─── Components / Groups ──────────────────────────────────────────────

export function useCreateStatusComponent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof createStatusComponentFn>[0]['data']) =>
      createStatusComponentFn({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKeys.components() }),
  })
}

export function useUpdateStatusComponent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof updateStatusComponentFn>[0]['data']) =>
      updateStatusComponentFn({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKeys.components() }),
  })
}

export function useDeleteStatusComponent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteStatusComponentFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKeys.components() }),
  })
}

export function useReorderStatusComponents() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => reorderStatusComponentsFn({ data: { ids } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKeys.components() }),
  })
}

export function useSetStatusComponentStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof setStatusComponentStatusFn>[0]['data']) =>
      setStatusComponentStatusFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKeys.components() })
      queryClient.invalidateQueries({ queryKey: statusKeys.overview() })
    },
  })
}

export function useCreateStatusGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof createStatusGroupFn>[0]['data']) =>
      createStatusGroupFn({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKeys.components() }),
  })
}

export function useUpdateStatusGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof updateStatusGroupFn>[0]['data']) =>
      updateStatusGroupFn({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKeys.components() }),
  })
}

export function useDeleteStatusGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteStatusGroupFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKeys.components() }),
  })
}

export function useReorderStatusGroups() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => reorderStatusGroupsFn({ data: { ids } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKeys.components() }),
  })
}

// ─── Incidents / Maintenance ──────────────────────────────────────────

export function useCreateStatusIncident() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof createStatusIncidentFn>[0]['data']) =>
      createStatusIncidentFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKeys.incidents() })
      queryClient.invalidateQueries({ queryKey: statusKeys.overview() })
    },
  })
}

/** Start a scheduled maintenance window immediately. Applies component
 *  statuses server-side, so component + overview caches invalidate too. */
export function useStartStatusMaintenanceNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => startStatusMaintenanceNowFn({ data: { id } }),
    onSuccess: (data) => {
      queryClient.setQueryData(statusKeys.incidentDetail(data.id), data)
      queryClient.invalidateQueries({ queryKey: statusKeys.incidents() })
      queryClient.invalidateQueries({ queryKey: statusKeys.components() })
      queryClient.invalidateQueries({ queryKey: statusKeys.overview() })
    },
  })
}

export function useUpdateStatusIncident() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof updateStatusIncidentFn>[0]['data']) =>
      updateStatusIncidentFn({ data: input }),
    onSuccess: (data) => {
      mergeIncidentDetail(queryClient, data)
      queryClient.invalidateQueries({ queryKey: statusKeys.incidents() })
      queryClient.invalidateQueries({ queryKey: statusKeys.overview() })
    },
  })
}

export function usePostStatusIncidentUpdate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof postStatusIncidentUpdateFn>[0]['data']) =>
      postStatusIncidentUpdateFn({ data: input }),
    onSuccess: (data) => {
      mergeIncidentDetail(queryClient, data)
      queryClient.invalidateQueries({ queryKey: statusKeys.incidents() })
      queryClient.invalidateQueries({ queryKey: statusKeys.components() })
      queryClient.invalidateQueries({ queryKey: statusKeys.overview() })
    },
  })
}

export function useDeleteStatusIncident() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteStatusIncidentFn({ data: { id } }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: statusKeys.incidentDetail(id) })
      queryClient.invalidateQueries({ queryKey: statusKeys.incidents() })
      queryClient.invalidateQueries({ queryKey: statusKeys.overview() })
    },
  })
}

/** Danger-zone: clear resolved incidents + uptime history. Invalidates both
 *  the incident lists and component queries (uptime bars reset). */
export function useClearStatusHistory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => clearStatusHistoryFn(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKeys.incidents() })
      queryClient.invalidateQueries({ queryKey: statusKeys.components() })
    },
  })
}

// ─── Templates ─────────────────────────────────────────────────────────

export function useCreateStatusIncidentTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof createStatusIncidentTemplateFn>[0]['data']) =>
      createStatusIncidentTemplateFn({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKeys.templates() }),
  })
}

export function useUpdateStatusIncidentTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof updateStatusIncidentTemplateFn>[0]['data']) =>
      updateStatusIncidentTemplateFn({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKeys.templates() }),
  })
}

export function useDeleteStatusIncidentTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteStatusIncidentTemplateFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKeys.templates() }),
  })
}

// ─── Settings ──────────────────────────────────────────────────────────

export function useUpdateStatusSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateStatusSettingsInput) => updateStatusSettingsFn({ data: input }),
    onSuccess: (saved) => queryClient.setQueryData(statusKeys.settings(), saved),
  })
}
