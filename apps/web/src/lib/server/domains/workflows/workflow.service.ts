/**
 * Workflow CRUD (support platform §4.6, Slice 5b). Workflows are authored under AI
 * & Automation and dispatched by the engine; this is the storage + lifecycle
 * (draft -> live -> paused) + drag order. Pure CRUD, no gate here — the fn layer
 * gates on `workflow.manage`. The dispatcher reads live workflows for a trigger
 * via listLiveWorkflowsForTrigger; the graph itself is walked by graph.ts.
 *
 * Also home to `getLiveWorkflowReferencedAttributeKeys` (AI-ATTRIBUTES-PARITY-
 * SPEC.md Phase 2): the assistant domain's cost gate for the mid-conversation
 * attribute re-check — see that function's doc.
 */
import { db, eq, and, isNull, inArray, asc, workflows, type Workflow } from '@/lib/server/db'
import type { WorkflowClass, WorkflowStatus } from '@/lib/server/db'
import type { WorkflowId, PrincipalId } from '@quackback/ids'
import { positionCaseSql } from '@/lib/server/utils'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
import type { WorkflowGraph, WorkflowNode } from './graph'
import { ATTRIBUTE_FIELD_PREFIX, type WorkflowCondition } from './condition.evaluator'
import {
  writeWorkflowVersion,
  workflowVersionFieldsChanged,
  pruneWorkflowVersions,
} from './workflow-versions'

export interface WorkflowInput {
  name: string
  class: WorkflowClass
  triggerType: string
  triggerSettings?: Record<string, unknown>
  graph?: WorkflowGraph
  sortOrder?: number
  createdBy?: PrincipalId | null
}

/** The graph is stored in a generic jsonb column; a WorkflowGraph is valid JSON
 *  but its typed node arrays don't structurally match the column's index type. */
const asJson = (graph: WorkflowGraph): Record<string, unknown> =>
  graph as unknown as Record<string, unknown>

export async function createWorkflow(input: WorkflowInput): Promise<Workflow> {
  const [row] = await db
    .insert(workflows)
    .values({
      name: input.name.trim(),
      class: input.class,
      triggerType: input.triggerType,
      triggerSettings: input.triggerSettings ?? {},
      graph: asJson(input.graph ?? { nodes: [], edges: [] }),
      sortOrder: input.sortOrder ?? 0,
      createdBy: input.createdBy ?? null,
    })
    .returning()
  invalidateHasLiveWorkflowCache()
  // Version history (support platform §4.6 version history + rollback): the
  // initial snapshot, authored by whoever created the workflow. Left as two
  // round trips (not wrapped in a transaction with the insert above) — unlike
  // updateWorkflow, there's no pre-existing row a crash here could leave
  // silently un-versioned; a crash before this line has nothing to lose
  // (the workflow simply doesn't exist yet), and a crash after the insert
  // but before the version write would leave a brand-new workflow with zero
  // version history, a materially smaller blast radius than updateWorkflow's
  // silently-lost EDIT this fix targets. Same writeWorkflowVersion/
  // pruneWorkflowVersions pattern either way, just not transactional here.
  await writeWorkflowVersion(row, input.createdBy ?? null)
  await pruneWorkflowVersions(row.id)
  return row
}

export async function listWorkflows(): Promise<Workflow[]> {
  return db
    .select()
    .from(workflows)
    .where(isNull(workflows.deletedAt))
    .orderBy(asc(workflows.sortOrder), asc(workflows.createdAt))
}

export async function getWorkflow(id: WorkflowId): Promise<Workflow | null> {
  const [row] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
    .limit(1)
  return row ?? null
}

/**
 * Update a workflow. `versionAuthor` attributes the version snapshot this
 * write may produce (support platform §4.6 version history + rollback) — the
 * principal making the save, or null for a system-authored write (e.g. a
 * migration/backfill). A version is only written when the patch actually
 * changes name/triggerType/triggerSettings/graph (see
 * workflowVersionFieldsChanged); a sortOrder-only drag-reorder or a
 * class-only flip writes nothing, since neither is a new "state" worth
 * restoring back to.
 *
 * The UPDATE and the version INSERT run inside ONE transaction: previously
 * these were two separate round trips, so a crash between them (the process
 * dying, the connection dropping) silently lost the version for a real,
 * already-committed edit — the workflow's live graph would be the new one,
 * but its version history would still show the old one as "current", making
 * a later rollback restore the WRONG state. The pre-read (`before`, needed to
 * even know whether this patch is version-worthy) and the retention prune
 * both stay outside: `before` only informs a comparison, never needs to be
 * transactionally consistent with the write it's compared against, and the
 * prune is a bounded best-effort cleanup that must not risk holding this
 * transaction open any longer than the two writes that actually matter.
 */
export async function updateWorkflow(
  id: WorkflowId,
  patch: Partial<Omit<WorkflowInput, 'createdBy'>>,
  versionAuthor?: PrincipalId | null
): Promise<Workflow> {
  // Whether this patch COULD touch a version-worthy field is knowable from
  // its own keys alone, before any read (see workflowVersionFieldsChanged's
  // field list) — a sortOrder-only drag-reorder or a class-only flip can
  // never produce a version, so skip both the `before` read and the write
  // below entirely rather than paying for a read this update will never use.
  const mayAffectVersion =
    patch.name !== undefined ||
    patch.triggerType !== undefined ||
    patch.triggerSettings !== undefined ||
    patch.graph !== undefined

  const before = mayAffectVersion ? await getWorkflow(id) : null

  const { row, versionWritten } = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workflows)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.class !== undefined ? { class: patch.class } : {}),
        ...(patch.triggerType !== undefined ? { triggerType: patch.triggerType } : {}),
        ...(patch.triggerSettings !== undefined ? { triggerSettings: patch.triggerSettings } : {}),
        ...(patch.graph !== undefined ? { graph: asJson(patch.graph) } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
      .returning()

    let versionWritten = false
    if (mayAffectVersion && row && before && workflowVersionFieldsChanged(before, row)) {
      await writeWorkflowVersion(row, versionAuthor ?? null, tx)
      versionWritten = true
    }
    return { row, versionWritten }
  })

  invalidateHasLiveWorkflowCache()
  // Best-effort, after commit — see the doc comment above.
  if (versionWritten) await pruneWorkflowVersions(row.id)
  return row
}

/** Transition a workflow's lifecycle (draft -> live -> paused and back). */
export async function setWorkflowStatus(id: WorkflowId, status: WorkflowStatus): Promise<Workflow> {
  const [row] = await db
    .update(workflows)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
    .returning()
  invalidateHasLiveWorkflowCache()
  return row
}

/**
 * Rewrite `sortOrder` to match the given order, in one batch UPDATE. This is
 * the drag-reorder write behind the manager's priority list, and it is what
 * decides which customer_facing workflow wins the exclusive first-match slot
 * for a trigger (see listLiveWorkflowsForTrigger and the dispatcher).
 *
 * `ids` is one trigger group as the manager displays it, so positions are
 * dense within that group only: sortOrder is compared per trigger by every
 * reader that cares, never across triggers, so two groups holding the same
 * positions is meaningless rather than ambiguous. Workflows outside `ids`
 * keep the sortOrder they have.
 *
 * No version snapshot: order is not a graph state anyone rolls back to (see
 * updateWorkflow's doc, which skips versioning a sortOrder-only patch for the
 * same reason). `updatedAt` holds still for the same reason — the manager
 * shows it as each workflow's last edit, and priority belongs to the group
 * rather than to any workflow whose definition it leaves untouched.
 */
export async function reorderWorkflows(ids: WorkflowId[]): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(workflows)
    .set({ sortOrder: positionCaseSql(workflows.id, ids) })
    .where(and(inArray(workflows.id, ids), isNull(workflows.deletedAt)))
}

/** Soft-delete: runs cascade on a hard delete, so soft-delete preserves history. */
export async function softDeleteWorkflow(id: WorkflowId): Promise<void> {
  const now = new Date()
  await db
    .update(workflows)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(workflows.id, id), isNull(workflows.deletedAt)))
  invalidateHasLiveWorkflowCache()
}

/**
 * The dispatcher's hot read: every live workflow for a trigger, in drag order.
 * customer_facing first-match and background parallel are both resolved by the
 * caller from this ordered list.
 */
export async function listLiveWorkflowsForTrigger(triggerType: string): Promise<Workflow[]> {
  return db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.triggerType, triggerType),
        eq(workflows.status, 'live'),
        isNull(workflows.deletedAt)
      )
    )
    .orderBy(asc(workflows.sortOrder), asc(workflows.createdAt))
}

// --- Any-live-workflow gate (support platform §4.6 hardening) ---
//
// events/process.ts pays a job-queue enqueue for the durable workflow-dispatch
// queue on every message/status event, even in a workspace with zero
// configured workflows. hasAnyLiveWorkflow() is the cheap "is there anything
// to enqueue for at all" pre-check that gate uses: cached briefly (like
// getLiveWorkflowReferencedAttributeKeys above) since it's read on the same
// hot per-message path, but ALSO invalidated eagerly by every mutation that
// can change liveness, so a workflow going live is visible immediately
// instead of waiting out the TTL.

const HAS_LIVE_WORKFLOW_CACHE_TTL_MS = 30_000

/** Per workspace, because the answer is a fact about one workspace's rows. */
const hasLiveWorkflowCache = new WorkspaceKeyedCache<{ value: boolean; expiresAt: number }>(2_048)
const HAS_LIVE_KEY = 'has-live'

/**
 * Drop the cached hasAnyLiveWorkflow answer so the next call re-queries.
 * Called by every mutation above that can change liveness (create/update/
 * setStatus/softDelete); exported so tests can start each case cold — the
 * cache is module-level mutable state that would otherwise leak a value
 * cached by an earlier case into a later one.
 */
export function invalidateHasLiveWorkflowCache(): void {
  hasLiveWorkflowCache.delete(HAS_LIVE_KEY)
  liveAttributeKeysCache.delete(LIVE_ATTRIBUTE_KEYS_KEY)
}

/**
 * Whether ANY workflow is currently live, workspace-global (not scoped by
 * trigger type). It must stay workspace-global: interruptWaitingRuns (§4.6)
 * has to run for every message/status event regardless of which specific
 * trigger type a live workflow subscribes to, since a run parked mid-wait on
 * ANY trigger can be ended by a reply/close on its conversation — scoping
 * this check to the current event's trigger type would wrongly skip that
 * interrupt when no live workflow happens to subscribe to it.
 *
 * A stale `false` (the cache hasn't yet noticed a workflow just went live) is
 * safe to gate the enqueue on: nothing can be waiting on a workflow that
 * hasn't dispatched a single run yet, so there's nothing to interrupt or
 * resume prematurely. Symmetrically, if the workspace's last live workflow is
 * paused while runs are still parked waiting on it, resumeWorkflowRun's own
 * paused-workflow check settles those runs as 'interrupted' when their timer
 * fires (see workflow.engine.ts) — so even a stale-false cache here can never
 * strand a waiting run un-resolved.
 */
export async function hasAnyLiveWorkflow(): Promise<boolean> {
  const now = Date.now()
  const cached = hasLiveWorkflowCache.get(HAS_LIVE_KEY)
  if (cached && cached.expiresAt > now) return cached.value
  const [row] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.status, 'live'), isNull(workflows.deletedAt)))
    .limit(1)
  const value = Boolean(row)
  hasLiveWorkflowCache.set(HAS_LIVE_KEY, { value, expiresAt: now + HAS_LIVE_WORKFLOW_CACHE_TTL_MS })
  return value
}

// --- Live-workflow attribute references (AI-ATTRIBUTES-PARITY-SPEC.md Phase 2) ---
//
// The Phase-2 live re-check cost gate: the industry-standard pattern where a
// mid-conversation re-classification only runs when some LIVE workflow
// condition actually branches on the attribute. No live workflow references
// any AI attribute -> no re-check ever fires, so the assistant orchestrator
// (a hot per-message path) can cheaply ask "is there anything to re-check at
// all?" before spending on a classification call.

/** Read the stored graph defensively — a malformed shape (or a still-empty
 *  draft) contributes no nodes rather than throwing. Mirrors
 *  workflow.engine.ts's `readGraph`, duplicated locally rather than imported
 *  to avoid a workflow.service -> workflow.engine edge (engine already
 *  depends on service for `getWorkflow`). */
function readGraphNodes(graph: unknown): WorkflowNode[] {
  const g = graph as Partial<WorkflowGraph> | null
  return Array.isArray(g?.nodes) ? g!.nodes : []
}

/** Recurse a condition tree (leaf or all/any group), collecting the key off
 *  every `conversation.attr.<key>` leaf into `into`. */
function collectAttributeKeys(condition: WorkflowCondition, into: Set<string>): void {
  if ('field' in condition) {
    if (condition.field.startsWith(ATTRIBUTE_FIELD_PREFIX)) {
      const key = condition.field.slice(ATTRIBUTE_FIELD_PREFIX.length)
      if (key) into.add(key)
    }
    return
  }
  for (const child of condition.all ?? []) collectAttributeKeys(child, into)
  for (const child of condition.any ?? []) collectAttributeKeys(child, into)
}

/** Every `conversation.attr.<key>` reference in one workflow's graph: both a
 *  standalone `condition` gate node and every branch of a `branch` node. */
function collectAttributeKeysFromGraph(graph: unknown, into: Set<string>): void {
  for (const node of readGraphNodes(graph)) {
    if (node.type === 'condition') {
      collectAttributeKeys(node.condition, into)
    } else if (node.type === 'branch') {
      for (const branch of node.branches) collectAttributeKeys(branch.condition, into)
    }
  }
}

/** Short-lived cache: a live workflow's conditions rarely change second to
 *  second, and this is read on every inbound customer message via the
 *  assistant orchestrator, so a module-level TTL cache (no existing caching
 *  idiom in this domain to follow) avoids a DB round trip per message. */
const LIVE_ATTRIBUTE_KEYS_CACHE_TTL_MS = 30_000

/** Per workspace: these keys are read from one workspace's stored graphs. */
const liveAttributeKeysCache = new WorkspaceKeyedCache<{
  keys: ReadonlySet<string>
  expiresAt: number
}>(2_048)
const LIVE_ATTRIBUTE_KEYS_KEY = 'live-attribute-keys'

/**
 * The set of attribute keys referenced as `conversation.attr.<key>` anywhere
 * in a condition or branch path of a currently-LIVE (not draft/paused)
 * workflow. Cached in-memory for `LIVE_ATTRIBUTE_KEYS_CACHE_TTL_MS`.
 */
export async function getLiveWorkflowReferencedAttributeKeys(): Promise<ReadonlySet<string>> {
  const now = Date.now()
  const cached = liveAttributeKeysCache.get(LIVE_ATTRIBUTE_KEYS_KEY)
  if (cached && cached.expiresAt > now) return cached.keys
  const live = await db
    .select({ graph: workflows.graph })
    .from(workflows)
    .where(and(eq(workflows.status, 'live'), isNull(workflows.deletedAt)))
  const keys = new Set<string>()
  for (const row of live) collectAttributeKeysFromGraph(row.graph, keys)
  liveAttributeKeysCache.set(LIVE_ATTRIBUTE_KEYS_KEY, {
    keys,
    expiresAt: now + LIVE_ATTRIBUTE_KEYS_CACHE_TTL_MS,
  })
  return keys
}

/** Test-only: clear the in-process cache between cases. */
export function __resetLiveWorkflowReferencedAttributeKeysCache(): void {
  liveAttributeKeysCache.clear()
}
