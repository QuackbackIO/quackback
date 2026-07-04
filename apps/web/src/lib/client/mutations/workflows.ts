/** Workflow CRUD + lifecycle mutations for the AI & Automation manager; each
 *  invalidates the list. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createWorkflowFn,
  updateWorkflowFn,
  setWorkflowStatusFn,
  deleteWorkflowFn,
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

export function useDeleteWorkflow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteWorkflowFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workflowKeys.all() }),
  })
}
