/** Workflow CRUD + lifecycle mutations for the AI & Automation manager; each
 *  invalidates the list. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createWorkflowFn,
  updateWorkflowFn,
  setWorkflowStatusFn,
  deleteWorkflowFn,
  reorderWorkflowsFn,
  type WorkflowDTO,
} from '@/lib/server/functions/workflows'
import { workflowKeys } from '@/lib/client/queries/workflows'

export function useCreateWorkflow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof createWorkflowFn>[0]['data']) =>
      createWorkflowFn({ data }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workflowKeys.all() }),
  })
}

export function useUpdateWorkflow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof updateWorkflowFn>[0]['data']) =>
      updateWorkflowFn({ data }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workflowKeys.all() }),
  })
}

export function useSetWorkflowStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof setWorkflowStatusFn>[0]['data']) =>
      setWorkflowStatusFn({ data }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workflowKeys.all() }),
  })
}

/** Apply a drag order to the cached list the way the server applies it: the
 *  reordered ids take dense positions, everything else keeps the position it
 *  has, and the list re-sorts on the same (sortOrder, createdAt) key the
 *  server reads it back by. */
function withOrder(list: readonly WorkflowDTO[], ids: readonly string[]): WorkflowDTO[] {
  const position = new Map(ids.map((id, i) => [id, i]))
  return [...list]
    .map((wf) => {
      const next = position.get(wf.id)
      return next === undefined ? wf : { ...wf, sortOrder: next }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
}

/** Persist a trigger group's drag order, which is what decides the winner of
 *  the customer-facing first-match slot. Applied to the cached list up front so
 *  the dropped row stays where it was dropped instead of snapping back for the
 *  width of the round trip; a failed write restores the order it replaced. */
export function useReorderWorkflows() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof reorderWorkflowsFn>[0]['data']) =>
      reorderWorkflowsFn({ data }),
    onMutate: async ({ ids }) => {
      await queryClient.cancelQueries({ queryKey: workflowKeys.all() })
      const previous = queryClient.getQueryData<WorkflowDTO[]>(workflowKeys.all())
      if (previous) queryClient.setQueryData(workflowKeys.all(), withOrder(previous, ids))
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(workflowKeys.all(), context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: workflowKeys.all() }),
  })
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteWorkflowFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workflowKeys.all() }),
  })
}
