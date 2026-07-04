/**
 * The workflow run engine (support platform §4.6, Slice 5d-i). runWorkflow takes
 * one workflow + a resolved condition snapshot, walks its graph, executes the
 * planned actions through the shared executor, and records the run + its timeline.
 * It is the single-workflow half of the dispatcher; the dispatcher (5d-ii) does
 * the human-actor gate, class split (customer_facing exclusive vs background
 * parallel), and frequency caps around it; durable-wait resume (5e) continues a
 * run from its cursor.
 *
 * Actions run under a service actor with admin authority — a workflow is
 * admin-configured automation acting on the workspace's behalf, mirroring the
 * full-API-key service principal. Each action is best-effort (a failure is logged
 * to the timeline and the run continues) so one bad action never strands a run.
 */
import {
  db,
  eq,
  workflowRuns,
  workflowRunEvents,
  type Workflow,
  type WorkflowRun,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import { logger } from '@/lib/server/logger'
import { applyAction } from './action.executor'
import { walkWorkflow, type WorkflowGraph } from './graph'
import type { ConditionContext } from './condition.evaluator'

const log = logger.child({ component: 'workflow-engine' })

/** The authority a workflow acts with: a service actor with admin permissions, so
 *  every catalogue action's canActAsAgent gate passes (like the full API key). */
function workflowActor(): Actor {
  return {
    principalId: null,
    role: 'admin',
    principalType: 'service',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

/** Read the stored graph defensively — a malformed shape becomes an empty graph
 *  (no nodes) so the walk simply produces nothing rather than throwing. */
function readGraph(workflow: Workflow): WorkflowGraph {
  const g = workflow.graph as unknown as Partial<WorkflowGraph> | null
  return {
    nodes: Array.isArray(g?.nodes) ? g!.nodes : [],
    edges: Array.isArray(g?.edges) ? g!.edges : [],
  }
}

async function logRunEvent(
  runId: string,
  workflowId: string,
  subjectPrincipalId: PrincipalId | null,
  kind: string
): Promise<void> {
  await db.insert(workflowRunEvents).values({
    runId: runId as WorkflowRun['id'],
    workflowId: workflowId as Workflow['id'],
    subjectPrincipalId,
    kind,
  })
}

export interface RunWorkflowOptions {
  conversationId: ConversationId
  /** The person the run acts on, for per-person frequency caps. */
  subjectPrincipalId?: PrincipalId | null
}

/**
 * Run one workflow against a conversation. Walks the graph, runs the planned
 * actions, and records a workflow_run + timeline. Returns null (no run created)
 * when the walk produces no actions and isn't waiting — an entry that matches
 * nothing is a silent no-op. On a wait the run is left in state 'waiting' with the
 * resume node in its cursor; Slice 5e schedules the timer and resumes.
 */
export async function runWorkflow(
  workflow: Workflow,
  ctx: ConditionContext,
  opts: RunWorkflowOptions
): Promise<WorkflowRun | null> {
  const plan = walkWorkflow(readGraph(workflow), ctx)
  if (plan.actions.length === 0 && plan.status !== 'waiting') return null

  const subjectPrincipalId = opts.subjectPrincipalId ?? null
  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowId: workflow.id,
      conversationId: opts.conversationId,
      subjectPrincipalId,
      state: 'running',
    })
    .returning()
  await logRunEvent(run.id, workflow.id, subjectPrincipalId, 'started')

  const actor = workflowActor()
  for (const action of plan.actions) {
    try {
      await applyAction(action, { conversationId: opts.conversationId, actor })
    } catch (err) {
      log.error({ err, action: action.type, workflowId: workflow.id }, 'workflow action failed')
      await logRunEvent(run.id, workflow.id, subjectPrincipalId, `action_failed:${action.type}`)
    }
  }

  if (plan.status === 'waiting') {
    const [waiting] = await db
      .update(workflowRuns)
      .set({
        state: 'waiting',
        cursor: { resumeNodeId: plan.resumeNodeId ?? null, waitSeconds: plan.waitSeconds ?? 0 },
      })
      .where(eq(workflowRuns.id, run.id))
      .returning()
    await logRunEvent(run.id, workflow.id, subjectPrincipalId, 'waiting')
    return waiting
  }

  const [done] = await db
    .update(workflowRuns)
    .set({ state: 'done', endedAt: new Date() })
    .where(eq(workflowRuns.id, run.id))
    .returning()
  await logRunEvent(run.id, workflow.id, subjectPrincipalId, 'completed')
  return done
}
