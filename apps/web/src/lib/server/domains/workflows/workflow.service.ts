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
import { db, eq, and, isNull, asc, workflows, type Workflow } from '@/lib/server/db'
import type { WorkflowClass, WorkflowStatus } from '@/lib/server/db'
import type { WorkflowId, PrincipalId } from '@quackback/ids'
import type { WorkflowGraph, WorkflowNode } from './graph'
import { ATTRIBUTE_FIELD_PREFIX, type WorkflowCondition } from './condition.evaluator'

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

export async function updateWorkflow(
  id: WorkflowId,
  patch: Partial<Omit<WorkflowInput, 'createdBy'>>
): Promise<Workflow> {
  const [row] = await db
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
  invalidateHasLiveWorkflowCache()
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
// events/process.ts pays a Redis enqueue for the durable workflow-dispatch
// queue on every message/status event, even in a workspace with zero
// configured workflows. hasAnyLiveWorkflow() is the cheap "is there anything
// to enqueue for at all" pre-check that gate uses: cached briefly (like
// getLiveWorkflowReferencedAttributeKeys above) since it's read on the same
// hot per-message path, but ALSO invalidated eagerly by every mutation that
// can change liveness, so a workflow going live is visible immediately
// instead of waiting out the TTL.

const HAS_LIVE_WORKFLOW_CACHE_TTL_MS = 30_000
let hasLiveWorkflowCache: { value: boolean; expiresAt: number } | null = null

/**
 * Drop the cached hasAnyLiveWorkflow answer so the next call re-queries.
 * Called by every mutation above that can change liveness (create/update/
 * setStatus/softDelete); exported so tests can start each case cold — the
 * cache is module-level mutable state that would otherwise leak a value
 * cached by an earlier case into a later one.
 */
export function invalidateHasLiveWorkflowCache(): void {
  hasLiveWorkflowCache = null
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
  if (hasLiveWorkflowCache && hasLiveWorkflowCache.expiresAt > now) {
    return hasLiveWorkflowCache.value
  }
  const [row] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.status, 'live'), isNull(workflows.deletedAt)))
    .limit(1)
  const value = Boolean(row)
  hasLiveWorkflowCache = { value, expiresAt: now + HAS_LIVE_WORKFLOW_CACHE_TTL_MS }
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
let liveAttributeKeysCache: { keys: ReadonlySet<string>; expiresAt: number } | null = null

/**
 * The set of attribute keys referenced as `conversation.attr.<key>` anywhere
 * in a condition or branch path of a currently-LIVE (not draft/paused)
 * workflow. Cached in-memory for `LIVE_ATTRIBUTE_KEYS_CACHE_TTL_MS`.
 */
export async function getLiveWorkflowReferencedAttributeKeys(): Promise<ReadonlySet<string>> {
  const now = Date.now()
  if (liveAttributeKeysCache && liveAttributeKeysCache.expiresAt > now) {
    return liveAttributeKeysCache.keys
  }
  const live = await db
    .select({ graph: workflows.graph })
    .from(workflows)
    .where(and(eq(workflows.status, 'live'), isNull(workflows.deletedAt)))
  const keys = new Set<string>()
  for (const row of live) collectAttributeKeysFromGraph(row.graph, keys)
  liveAttributeKeysCache = { keys, expiresAt: now + LIVE_ATTRIBUTE_KEYS_CACHE_TTL_MS }
  return keys
}

/** Test-only: clear the in-process cache between cases. */
export function __resetLiveWorkflowReferencedAttributeKeysCache(): void {
  liveAttributeKeysCache = null
}
