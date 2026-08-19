/**
 * Dry-run preview for a workflow (support platform §4.6 dry-run preview).
 * Loads the SAVED workflow — any status, including draft, since the whole
 * point is to check a workflow BEFORE it goes live — resolves the same
 * `ConditionContext` snapshot the dispatcher would for a real conversation
 * (resolveConditionContext, condition.context.ts), evaluates the trigger's
 * audience predicate for real (audienceAllows, dispatcher.guards.ts), then
 * walks the graph collecting an ordered trace of what would happen.
 *
 * NOTHING is written: no run, no run event, no message, no action side
 * effect. This module never calls workflow.engine.ts's runWorkflow or
 * action.executor.ts's executeAction — it only reads the workflow + the
 * conversation snapshot and does pure, in-memory graph traversal.
 *
 * The trace walker below is deliberately its OWN small traversal, not a call
 * into graph.ts's `walkWorkflow` — a preview is always a FRESH walk (no
 * `blockAnswer`/`assistantOutcome` ever in scope, since nothing has actually
 * parked and been answered), so it only ever needs each node kind's
 * first-visit behavior, which is simple enough to restate directly: continue
 * through a plain node, evaluate a condition/branch node for real against
 * the resolved context, and stop at whichever node kind graph.ts's module
 * doc calls a PARKING kind (wait, any interactive block, let_assistant_answer)
 * — see describeNode below for the exhaustive per-kind mapping, kept in sync
 * with graph.ts's WorkflowNode union by the switch's `default` arm treating
 * any kind this module doesn't yet know about as parking (fail toward "stop
 * and show it", never toward silently fabricating a plan past an unknown
 * node).
 */
import type { ConversationId, WorkflowId } from '@quackback/ids'
import type { WorkflowStatus } from '@/lib/server/db'
import { NotFoundError } from '@/lib/shared/errors'
import { getWorkflow } from './workflow.service'
import { resolveConditionContext } from './condition.context'
import { audienceAllows } from './dispatcher.guards'
import { evaluateCondition, type ConditionContext } from './condition.evaluator'
import type { WorkflowGraph, WorkflowNode } from './graph'

/** Read the stored graph defensively — a malformed/empty shape just
 *  contributes no nodes rather than throwing. Duplicated locally (not
 *  imported) same as workflow.service.ts's own readGraphNodes and
 *  workflow.engine.ts's readGraph — see either one's doc for why this tiny
 *  reader is deliberately not shared across the module boundary. */
function readGraph(graph: unknown): WorkflowGraph {
  const g = graph as Partial<WorkflowGraph> | null
  return {
    nodes: Array.isArray(g?.nodes) ? g.nodes : [],
    edges: Array.isArray(g?.edges) ? g.edges : [],
  }
}

function successorId(graph: WorkflowGraph, nodeId: string, branch?: string): string | undefined {
  const edge = graph.edges.find(
    (e) => e.from === nodeId && (branch === undefined ? !e.branch : e.branch === branch)
  )
  return edge?.to
}

function nextNode(graph: WorkflowGraph, id: string | undefined): WorkflowNode | undefined {
  return id ? graph.nodes.find((n) => n.id === id) : undefined
}

function humanizeType(type: string): string {
  return type
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

/** One trace row's shape. `outcome`: 'planned' = the walk passed through (or
 *  will act) here and continues; 'parked' = this is where a real run would
 *  stop and wait (a timer, an interactive block, or Quinn); 'end' = the walk
 *  terminates here (an unmatched condition/branch, or simply no successor). */
export interface WorkflowPreviewTraceEntry {
  nodeId: string
  kind: string
  summary: string
  outcome: 'planned' | 'parked' | 'end'
}

/** A node's fresh-visit summary + whether it parks — the first-visit-only
 *  subset of graph.ts's node semantics this preview needs (see the module
 *  doc). Condition/branch nodes are handled separately by the walker itself
 *  (they need the resolved context to describe, not just the node). */
function describeNode(node: WorkflowNode): { summary: string; parks: boolean } {
  switch (node.type) {
    case 'trigger':
      return { summary: 'Trigger fires', parks: false }
    case 'action':
      return { summary: `Action: ${humanizeType(node.action.type)}`, parks: false }
    case 'wait':
      return { summary: `Wait ${node.seconds}s`, parks: true }
    case 'message':
      return { summary: 'Send message', parks: false }
    case 'show_reply_time':
      return { summary: 'Show reply time', parks: false }
    case 'disable_composer':
      return { summary: 'Disable composer', parks: false }
    case 'let_assistant_answer':
      return { summary: 'Let assistant answer', parks: true }
    case 'reply_buttons':
      return { summary: 'Reply buttons (awaiting customer)', parks: true }
    case 'collect_data':
      return { summary: 'Collect data (awaiting customer)', parks: true }
    case 'collect_reply':
      return { summary: 'Collect reply (awaiting customer)', parks: true }
    case 'request_csat':
      return { summary: 'Request CSAT (awaiting customer)', parks: true }
    default:
      // Any node kind this module doesn't recognize (a future addition, or a
      // malformed stored value) is treated as an unknown PARK status per the
      // feature spec: fail toward "stop and show it" rather than guessing.
      return { summary: humanizeType((node as { type: string }).type), parks: true }
  }
}

const MAX_PREVIEW_STEPS = 500

/** Walk the graph from its trigger, collecting an ordered trace. Always a
 *  fresh walk (preview never resumes), same visited-set + step cap
 *  contract graph.ts's walkWorkflow uses to keep a malformed/cyclic graph
 *  from looping forever. */
function traceWalk(
  graph: WorkflowGraph,
  ctx: ConditionContext
): { trace: WorkflowPreviewTraceEntry[]; finalStatus: 'completed' | 'waiting' | 'halted' } {
  const trace: WorkflowPreviewTraceEntry[] = []
  const visited = new Set<string>()
  let node: WorkflowNode | undefined = graph.nodes.find((n) => n.type === 'trigger')

  for (let step = 0; step < MAX_PREVIEW_STEPS && node; step++) {
    if (visited.has(node.id)) return { trace, finalStatus: 'completed' }
    visited.add(node.id)

    if (node.type === 'condition') {
      const met = evaluateCondition(node.condition, ctx)
      if (!met) {
        trace.push({
          nodeId: node.id,
          kind: node.type,
          summary: 'Condition not met',
          outcome: 'end',
        })
        return { trace, finalStatus: 'halted' }
      }
      trace.push({ nodeId: node.id, kind: node.type, summary: 'Condition met', outcome: 'planned' })
      node = nextNode(graph, successorId(graph, node.id))
      continue
    }

    if (node.type === 'branch') {
      const match = node.branches.find((b) => evaluateCondition(b.condition, ctx))
      if (!match) {
        trace.push({
          nodeId: node.id,
          kind: node.type,
          summary: 'No branch matched',
          outcome: 'end',
        })
        return { trace, finalStatus: 'halted' }
      }
      trace.push({
        nodeId: node.id,
        kind: node.type,
        summary: `Branch matched: ${match.key}`,
        outcome: 'planned',
      })
      node = nextNode(graph, successorId(graph, node.id, match.key))
      continue
    }

    const { summary, parks } = describeNode(node)
    if (parks) {
      trace.push({ nodeId: node.id, kind: node.type, summary, outcome: 'parked' })
      return { trace, finalStatus: 'waiting' }
    }

    const next = successorId(graph, node.id)
    trace.push({ nodeId: node.id, kind: node.type, summary, outcome: next ? 'planned' : 'end' })
    node = nextNode(graph, next)
  }

  return { trace, finalStatus: 'completed' }
}

export interface WorkflowPreviewResult {
  workflowId: WorkflowId
  workflowStatus: WorkflowStatus
  /** Whether the trigger has an audience predicate configured at all — the
   *  UI reads `audienceMatched` as N/A (not a real verdict) when this is
   *  false, same as audienceAllows' own "no audience configured -> always
   *  allows" contract. */
  audienceConfigured: boolean
  audienceMatched: boolean
  trace: WorkflowPreviewTraceEntry[]
  finalStatus: 'completed' | 'waiting' | 'halted'
}

/**
 * Dry-run a workflow against a real conversation. Read-only: resolves the
 * exact same condition snapshot a live dispatch would, evaluates the
 * audience predicate and every condition/branch node for real, and reports
 * where the run would park or end — without starting a run, writing an
 * event, or sending anything.
 */
export async function previewWorkflow(input: {
  workflowId: WorkflowId
  conversationId: ConversationId
}): Promise<WorkflowPreviewResult> {
  const workflow = await getWorkflow(input.workflowId)
  if (!workflow) throw new NotFoundError('NOT_FOUND', 'Workflow not found')

  const ctx = await resolveConditionContext(input.conversationId, {})
  if (!ctx) throw new NotFoundError('NOT_FOUND', 'Conversation not found')

  const audience = workflow.triggerSettings.audience
  const audienceConfigured = audience !== undefined && audience !== null
  const audienceMatched = audienceAllows(workflow, ctx)

  const { trace, finalStatus } = traceWalk(readGraph(workflow.graph), ctx)

  return {
    workflowId: workflow.id,
    workflowStatus: workflow.status,
    audienceConfigured,
    audienceMatched,
    trace,
    finalStatus,
  }
}
