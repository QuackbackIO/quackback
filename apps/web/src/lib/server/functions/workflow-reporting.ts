/**
 * Workflow run metrics for the workflows manager list (support platform §4.6).
 * Distinct from `support-reporting.ts`'s analytics-dashboard version: that one
 * gates on `analytics.view` for the reporting surface, while the manager list
 * is gated on `routing.manage` (the same permission `listWorkflowsFn` reads
 * behind), so anyone who can see the workflow list can see its run counts.
 *
 * workflowRunsFn / workflowRunTimelineFn are the per-run drill-down: a run
 * list for a workflow (recent-first, capped), and one run's ordered event
 * timeline — same routing.manage gate, read-only, JSON-safe DTOs.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { WorkflowId, WorkflowRunId } from '@quackback/ids'
import type { WorkflowRunState } from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  workflowEffectiveness,
  listWorkflowRuns,
  workflowRunTimeline,
} from '@/lib/server/domains/workflows/workflow-reporting'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export interface WorkflowEffectivenessRow {
  workflowId: string
  started: number
  completed: number
  /** Funnel (customer-facing workflows only, see workflows-manager.tsx):
   *  distinct runs with >= 1 block_sent / block_engaged event, same 7d window. */
  sentRuns: number
  engagedRuns: number
}

/** Runs started/completed per workflow over the trailing 7 days. */
export const workflowEffectivenessFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WorkflowEffectivenessRow[]> => {
    await requireAuth({ permission: PERMISSIONS.ROUTING_MANAGE })
    const to = new Date()
    const from = new Date(to.getTime() - SEVEN_DAYS_MS)
    return (await workflowEffectiveness(from, to)).map((row) => ({
      workflowId: row.workflowId as string,
      started: row.started,
      completed: row.completed,
      sentRuns: row.sentRuns,
      engagedRuns: row.engagedRuns,
    }))
  }
)

const workflowIdSchema = z.object({ workflowId: z.string() })
const runIdSchema = z.object({ runId: z.string() })

export interface WorkflowRunRow {
  id: string
  state: WorkflowRunState
  startedAt: string
  endedAt: string | null
  conversationId: string | null
}

/** A workflow's recent runs (newest first, capped) for the manager list's
 *  drill-down sheet. */
export const workflowRunsFn = createServerFn({ method: 'GET' })
  .validator(workflowIdSchema)
  .handler(async ({ data }): Promise<WorkflowRunRow[]> => {
    await requireAuth({ permission: PERMISSIONS.ROUTING_MANAGE })
    const rows = await listWorkflowRuns(data.workflowId as WorkflowId)
    return rows.map((r) => ({
      id: r.id,
      state: r.state,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
      conversationId: r.conversationId,
    }))
  })

export interface WorkflowRunEventRow {
  kind: string
  at: string
}

/** One run's ordered event timeline (oldest first). */
export const workflowRunTimelineFn = createServerFn({ method: 'GET' })
  .validator(runIdSchema)
  .handler(async ({ data }): Promise<WorkflowRunEventRow[]> => {
    await requireAuth({ permission: PERMISSIONS.ROUTING_MANAGE })
    const rows = await workflowRunTimeline(data.runId as WorkflowRunId)
    return rows.map((r) => ({ kind: r.kind, at: r.at.toISOString() }))
  })
