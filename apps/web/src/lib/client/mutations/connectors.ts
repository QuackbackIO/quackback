/** Data connector CRUD + test-call mutations for the AI & Automation admin
 *  UI; each write invalidates the list. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createDataConnectorFn,
  updateDataConnectorFn,
  deleteDataConnectorFn,
  testDataConnectorFn,
} from '@/lib/server/functions/data-connectors'
import { connectorKeys } from '@/lib/client/queries/connectors'

function useConnectorMutation<A, R>(fn: (a: A) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectorKeys.all() }),
  })
}

export function useCreateConnector() {
  return useConnectorMutation((data: Parameters<typeof createDataConnectorFn>[0]['data']) =>
    createDataConnectorFn({ data })
  )
}

export function useUpdateConnector() {
  return useConnectorMutation((data: Parameters<typeof updateDataConnectorFn>[0]['data']) =>
    updateDataConnectorFn({ data })
  )
}

export function useDeleteConnector() {
  return useConnectorMutation((id: string) => deleteDataConnectorFn({ data: { id } }))
}

export function useToggleConnectorEnabled() {
  return useConnectorMutation((params: { id: string; enabled: boolean }) =>
    updateDataConnectorFn({ data: params })
  )
}

/** Runs a live test call; also invalidates the list since a successful run
 *  persists example_response/lastTestedAt (and any run updates the circuit
 *  breaker's failureCount/status). */
export function useTestConnector() {
  return useConnectorMutation((data: Parameters<typeof testDataConnectorFn>[0]['data']) =>
    testDataConnectorFn({ data })
  )
}
