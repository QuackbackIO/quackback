import { queryOptions } from '@tanstack/react-query'
import {
  listWorkflowsFn,
  getWorkflowFn,
  listWorkflowVersionsFn,
  listRunnableWorkflowsFn,
} from '@/lib/server/functions/workflows'

/** Query keys for the workflows manager (AI & Automation). */
export const workflowKeys = {
  all: () => ['workflows'] as const,
  detail: (id: string) => ['workflows', id] as const,
  versions: (id: string) => ['workflows', id, 'versions'] as const,
  runnable: () => ['workflows', 'runnable'] as const,
}

/** Every workflow, in drag order (the AI & Automation manager list). */
export const workflowsQuery = () =>
  queryOptions({
    queryKey: workflowKeys.all(),
    queryFn: () => listWorkflowsFn(),
    staleTime: 60 * 1000,
  })

/** One workflow (null if deleted/missing), for the fullscreen builder route. */
export const workflowDetailQuery = (id: string) =>
  queryOptions({
    queryKey: workflowKeys.detail(id),
    queryFn: () => getWorkflowFn({ data: { id } }),
    staleTime: 30 * 1000,
  })

/** A workflow's version history, newest first — the builder's History sheet
 *  (support platform §4.6 version history + rollback). Disabled while `id`
 *  is null so a closed sheet never pays for a fetch, same idiom as
 *  workflow-reporting.ts's run-history queries. */
export const workflowVersionsQuery = (id: string | null) =>
  queryOptions({
    queryKey: workflowKeys.versions(id ?? 'none'),
    queryFn: () => listWorkflowVersionsFn({ data: { workflowId: id! } }),
    enabled: id !== null,
    staleTime: 10 * 1000,
  })

/** Live workflows a teammate can fire manually from the inbox composer
 *  (workflow-run-picker.tsx) — same staleness idiom as macrosQuery, since
 *  this is the same kind of rarely-changing composer-toolbar list. */
export const runnableWorkflowsQuery = () =>
  queryOptions({
    queryKey: workflowKeys.runnable(),
    queryFn: () => listRunnableWorkflowsFn(),
    staleTime: 60 * 1000,
  })
