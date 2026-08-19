/**
 * Workflow version history + rollback storage (support platform §4.6). One
 * row per meaningful save of a workflow — workflow.service.ts's
 * createWorkflow (the initial version) and updateWorkflow (only when the
 * patch actually changes name/triggerType/triggerSettings/graph, via
 * `workflowVersionFieldsChanged` below) are the only writers. Deliberately
 * bounded, not a permanent audit log: every write is followed by a prune
 * back to the workflow's newest `MAX_WORKFLOW_VERSIONS` rows (each call
 * site's own best-effort call, made after its write commits — see
 * writeWorkflowVersion's doc), so this reads as "recent states this workflow
 * has been saved in", not a full history.
 *
 * A version snapshots the workflow's state AS SAVED (the row just written),
 * not the state before the edit — restoring an older version is then just
 * "apply this snapshot via the normal update path", and that restore itself
 * produces a fresh version row, which is the correct, expected behavior (see
 * functions/workflows.ts's restoreWorkflowVersionFn).
 */
import {
  db,
  and,
  eq,
  desc,
  notInArray,
  workflowVersions,
  principal,
  user,
  type Workflow,
  type WorkflowVersion,
  type Transaction,
} from '@/lib/server/db'
import type { WorkflowId, PrincipalId, WorkflowVersionId } from '@quackback/ids'

/** Retention cap: after every insert, a workflow is pruned back to its
 *  newest N versions (see pruneWorkflowVersions). */
export const MAX_WORKFLOW_VERSIONS = 50

/** Same Executor pattern as workflow-run-events.ts's logRunEvent: defaults to
 *  `db`, but a caller already inside a transaction can pass its `tx` so the
 *  version INSERT lands atomically with whatever else it's writing. */
type Executor = typeof db | Transaction

/** Recursively sort object keys so two jsonb values that are structurally
 *  equal but differ only in key order (e.g. after a round trip through
 *  Postgres/Drizzle) stringify identically. Used only for the version
 *  change-detection comparison below — nowhere else needs this. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep(record[key])
        return acc
      }, {})
  }
  return value
}

const stableStringify = (value: unknown): string => JSON.stringify(sortKeysDeep(value))

/**
 * Whether the fields a version snapshot cares about actually changed between
 * two persisted rows of the SAME workflow (its state before an update vs.
 * after). Order-independent on the two jsonb fields so key-order churn
 * through a JSONB round trip never manufactures a spurious version — only a
 * real content change does. `sortOrder` and `class` are deliberately excluded
 * (a drag-reorder or class flip alone isn't a "new state" worth a version).
 */
export function workflowVersionFieldsChanged(before: Workflow, after: Workflow): boolean {
  return (
    before.name !== after.name ||
    before.triggerType !== after.triggerType ||
    stableStringify(before.triggerSettings) !== stableStringify(after.triggerSettings) ||
    stableStringify(before.graph) !== stableStringify(after.graph)
  )
}

/**
 * Snapshot `workflow`'s CURRENT persisted state as a new version row.
 * `createdBy` is who made the save that produced this state (null for a
 * system-authored write). `executor` (optional) lets a caller that just
 * wrote the workflow row itself inside its own transaction pass that same
 * `tx` here, so the version insert commits atomically with it rather than in
 * a second round trip a crash could land between (see updateWorkflow) —
 * defaults to `db` for a standalone caller (createWorkflow).
 *
 * Deliberately does NOT prune here anymore: pruning is a bounded best-effort
 * cleanup, not something that needs (or should try to hold) the same
 * transaction — see updateWorkflow's own prune call, made after its
 * transaction commits.
 */
export async function writeWorkflowVersion(
  workflow: Workflow,
  createdBy: PrincipalId | null,
  executor: Executor = db
): Promise<void> {
  await executor.insert(workflowVersions).values({
    workflowId: workflow.id,
    name: workflow.name,
    triggerType: workflow.triggerType,
    triggerSettings: workflow.triggerSettings,
    graph: workflow.graph,
    createdBy,
  })
}

/**
 * Delete every version row for `workflowId` beyond the newest
 * `MAX_WORKFLOW_VERSIONS` (by created_at desc) — a single delete keyed off a
 * subquery of the ids to keep, rather than a read-then-delete round trip.
 */
export async function pruneWorkflowVersions(workflowId: WorkflowId): Promise<void> {
  const keepIds = db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, workflowId))
    .orderBy(desc(workflowVersions.createdAt), desc(workflowVersions.id))
    .limit(MAX_WORKFLOW_VERSIONS)

  await db
    .delete(workflowVersions)
    .where(
      and(eq(workflowVersions.workflowId, workflowId), notInArray(workflowVersions.id, keepIds))
    )
}

export interface WorkflowVersionRow {
  id: WorkflowVersionId
  workflowId: WorkflowId
  name: string
  triggerType: string
  triggerSettings: Record<string, unknown>
  graph: Record<string, unknown>
  createdBy: PrincipalId | null
  /** Best-available display name for `createdBy` (synced user.name, falling
   *  back to the principal's own displayName — same precedence
   *  workflow-variables.ts's resolveWorkflowVariables uses), or null when
   *  the author is unset/deleted. */
  createdByName: string | null
  createdAt: Date
}

/** A workflow's versions, newest first (bounded by the retention cap, so no
 *  separate limit is needed beyond it). */
export async function listWorkflowVersions(workflowId: WorkflowId): Promise<WorkflowVersionRow[]> {
  const rows = await db
    .select({
      id: workflowVersions.id,
      workflowId: workflowVersions.workflowId,
      name: workflowVersions.name,
      triggerType: workflowVersions.triggerType,
      triggerSettings: workflowVersions.triggerSettings,
      graph: workflowVersions.graph,
      createdBy: workflowVersions.createdBy,
      createdAt: workflowVersions.createdAt,
      principalDisplayName: principal.displayName,
      userName: user.name,
    })
    .from(workflowVersions)
    .leftJoin(principal, eq(principal.id, workflowVersions.createdBy))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(workflowVersions.workflowId, workflowId))
    // Tiebreak on id (UUIDv7, itself time-ordered) alongside createdAt: two
    // saves landing in the same createdAt tick (a rapid create-then-update,
    // or simply a coarse clock) would otherwise sort arbitrarily.
    .orderBy(desc(workflowVersions.createdAt), desc(workflowVersions.id))
    .limit(MAX_WORKFLOW_VERSIONS)

  return rows.map((r) => ({
    id: r.id,
    workflowId: r.workflowId,
    name: r.name,
    triggerType: r.triggerType,
    triggerSettings: r.triggerSettings,
    graph: r.graph,
    createdBy: r.createdBy,
    createdByName: (r.userName ?? r.principalDisplayName ?? null)?.trim() || null,
    createdAt: r.createdAt,
  }))
}

/** One version by id, or null. */
export async function getWorkflowVersion(id: WorkflowVersionId): Promise<WorkflowVersion | null> {
  const [row] = await db.select().from(workflowVersions).where(eq(workflowVersions.id, id)).limit(1)
  return row ?? null
}
