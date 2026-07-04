import { queryOptions } from '@tanstack/react-query'
import { listWorkflowsFn } from '@/lib/server/functions/workflows'

/** Query keys for the workflows manager (AI & Automation). */
export const workflowKeys = {
  all: () => ['workflows'] as const,
}

/** Every workflow, in drag order (the AI & Automation manager list). */
export const workflowsQuery = () =>
  queryOptions({
    queryKey: workflowKeys.all(),
    queryFn: () => listWorkflowsFn(),
    staleTime: 60 * 1000,
  })
