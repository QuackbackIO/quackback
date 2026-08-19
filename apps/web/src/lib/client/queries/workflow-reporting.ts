import { queryOptions } from '@tanstack/react-query'
import {
  workflowEffectivenessFn,
  workflowRunsFn,
  workflowRunTimelineFn,
} from '@/lib/server/functions/workflow-reporting'

/** Per-workflow run counts over the trailing 7 days, for the workflows list. */
export const workflowEffectivenessQuery = () =>
  queryOptions({
    queryKey: ['workflow-effectiveness', '7d'],
    queryFn: () => workflowEffectivenessFn(),
    staleTime: 5 * 60 * 1000,
  })

/** A workflow's recent runs (newest first, capped) — the manager list's
 *  per-workflow drill-down. Disabled with no workflowId (the sheet closed). */
export const workflowRunsQuery = (workflowId: string | null) =>
  queryOptions({
    queryKey: ['workflow-runs', workflowId],
    queryFn: () => workflowRunsFn({ data: { workflowId: workflowId! } }),
    enabled: !!workflowId,
    staleTime: 30 * 1000,
  })

/** One run's ordered event timeline — the drill-down's selected-run detail. */
export const workflowRunTimelineQuery = (runId: string | null) =>
  queryOptions({
    queryKey: ['workflow-run-timeline', runId],
    queryFn: () => workflowRunTimelineFn({ data: { runId: runId! } }),
    enabled: !!runId,
    staleTime: 30 * 1000,
  })
