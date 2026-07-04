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
  and,
  eq,
  inArray,
  workflowRuns,
  workflowRunEvents,
  type Workflow,
  type WorkflowRun,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { applyAction } from './action.executor'
import { walkWorkflow, type WorkflowGraph, type WalkResult } from './graph'
import type { ConditionContext } from './condition.evaluator'
import { getWorkflow } from './workflow.service'
import { resolveConditionContext } from './condition.context'
import { scheduleWorkflowResume } from './workflow-wait-queue'

const log = logger.child({ component: 'workflow-engine' })

/**
 * The bounded authority a workflow acts with: exactly the support actions the v1
 * catalogue applies, named explicitly rather than inheriting the whole admin role
 * — so the ceiling stays intentional and can't silently widen as admin grows. A
 * workflow can act on conversations but nothing outside support.
 */
const AUTOMATION_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_VIEW_ALL,
  PERMISSIONS.CONVERSATION_REPLY, // the canActAsAgent gate every action passes
  PERMISSIONS.CONVERSATION_ASSIGN,
  PERMISSIONS.CONVERSATION_SET_STATUS,
  PERMISSIONS.CONVERSATION_SET_TAGS,
  PERMISSIONS.CONVERSATION_SET_ATTRIBUTES,
  PERMISSIONS.SLA_MANAGE,
])

function workflowActor(): Actor {
  return {
    principalId: null,
    role: 'admin',
    principalType: 'service',
    segmentIds: new Set(),
    // The bounded set, not resolveActorPermissions('admin') — can() reads
    // actor.permissions, so this is the effective ceiling.
    permissions: new Set(AUTOMATION_PERMISSIONS),
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

  return applyPlanAndSettle(run, workflow, plan, opts.conversationId, subjectPrincipalId)
}

/**
 * Run the actions of a walk plan (best-effort) then settle the run: on a wait,
 * persist the resume cursor + schedule the durable timer and stay 'waiting'; else
 * mark it done. Shared by a fresh run and a resumed one.
 */
async function applyPlanAndSettle(
  run: WorkflowRun,
  workflow: Workflow,
  plan: WalkResult,
  conversationId: ConversationId,
  subjectPrincipalId: PrincipalId | null
): Promise<WorkflowRun> {
  const actor = workflowActor()
  for (const action of plan.actions) {
    try {
      await applyAction(action, { conversationId, actor })
    } catch (err) {
      log.error({ err, action: action.type, workflowId: workflow.id }, 'workflow action failed')
      await logRunEvent(run.id, workflow.id, subjectPrincipalId, `action_failed:${action.type}`)
    }
  }

  if (plan.status === 'waiting') {
    const waitSeconds = plan.waitSeconds ?? 0
    const [waiting] = await db
      .update(workflowRuns)
      .set({ state: 'waiting', cursor: { resumeNodeId: plan.resumeNodeId ?? null, waitSeconds } })
      .where(eq(workflowRuns.id, run.id))
      .returning()
    await logRunEvent(run.id, workflow.id, subjectPrincipalId, 'waiting')
    await scheduleWorkflowResume(run.id, waitSeconds)
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

/**
 * Resume a waiting run when its timer fires (called by the wait worker). Re-loads
 * the run's state first: a run interrupted by a reply/close, already done, or
 * whose workflow/conversation is gone does not resume. Otherwise it re-resolves
 * the snapshot and walks on from the cursor. The original triggering message is
 * not available post-wait, so a post-wait message condition sees none.
 */
export async function resumeWorkflowRun(runId: WorkflowRun['id']): Promise<WorkflowRun | null> {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1)
  if (!run || run.state !== 'waiting') return null // interrupted / already handled

  const resumeNodeId = (run.cursor as { resumeNodeId?: string | null }).resumeNodeId
  const workflow = run.conversationId ? await getWorkflow(run.workflowId) : null
  const ctx = run.conversationId ? await resolveConditionContext(run.conversationId) : null
  if (!resumeNodeId || !workflow || !run.conversationId || !ctx) {
    // Nothing left to run, or the workflow/conversation vanished — settle it.
    const state = !resumeNodeId ? 'done' : 'interrupted'
    const [ended] = await db
      .update(workflowRuns)
      .set({ state, endedAt: new Date() })
      .where(eq(workflowRuns.id, run.id))
      .returning()
    return ended
  }

  await db.update(workflowRuns).set({ state: 'running' }).where(eq(workflowRuns.id, run.id))
  const plan = walkWorkflow(readGraph(workflow), ctx, resumeNodeId)
  return applyPlanAndSettle(run, workflow, plan, run.conversationId, run.subjectPrincipalId)
}

/**
 * End every waiting run on a conversation (a reply or close interrupts pending
 * waits, per §4.6). Returns how many were interrupted. Wired into the reply/close
 * paths as a follow-up; the wait worker also re-checks state, so a late timer on
 * an interrupted run is already a no-op.
 */
export async function interruptWaitingRuns(conversationId: ConversationId): Promise<number> {
  const interrupted = await db
    .update(workflowRuns)
    .set({ state: 'interrupted', endedAt: new Date() })
    .where(
      and(
        eq(workflowRuns.conversationId, conversationId),
        inArray(workflowRuns.state, ['running', 'waiting'])
      )
    )
    .returning({ id: workflowRuns.id })
  return interrupted.length
}
