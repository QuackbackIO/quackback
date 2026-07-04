/**
 * The workflow graph model + walker (support platform §4.6, Slice 5c). A workflow
 * stores its canvas as JSONB `{ nodes, edges }`; this is the shape and the pure
 * function that walks it. Given a graph and a resolved ConditionContext it returns
 * the ordered actions to run now and where it stopped — the end, a durable wait
 * (with the node to resume from), or a halt at an unmatched branch/gate. It never
 * touches the DB or runs actions: the dispatcher (Slice 5d) executes the returned
 * plan and, on a wait, persists the resume node in the run cursor.
 *
 * Node kinds: trigger (entry), action (a catalogue action), condition (a gate:
 * continue only if it holds), branch (first matching path wins), wait (pause N
 * seconds, then resume). The walk is defensive — a missing edge/node ends the
 * path, and a visited-set + step cap make a malformed cyclic graph terminate.
 */
import type { WorkflowAction } from './action.executor'
import {
  evaluateCondition,
  type WorkflowCondition,
  type ConditionContext,
} from './condition.evaluator'

export interface WorkflowEdge {
  from: string
  to: string
  /** For an edge leaving a branch node, which branch key it carries. */
  branch?: string
}

export type WorkflowNode =
  | { id: string; type: 'trigger' }
  | { id: string; type: 'action'; action: WorkflowAction }
  | { id: string; type: 'condition'; condition: WorkflowCondition }
  | { id: string; type: 'branch'; branches: { key: string; condition: WorkflowCondition }[] }
  | { id: string; type: 'wait'; seconds: number }

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface WalkResult {
  /** Actions to run now, in order (empty if the path halts before any action). */
  actions: WorkflowAction[]
  /** completed = reached the end; waiting = hit a wait; halted = a gate/branch
   *  matched nothing (the path stops, no more actions). */
  status: 'completed' | 'waiting' | 'halted'
  /** Seconds to wait (status = waiting). */
  waitSeconds?: number
  /** The node to resume from after the wait (status = waiting) — the wait's
   *  successor, so resuming never re-waits. Undefined if the wait has no successor
   *  (treated as completed-after-wait). */
  resumeNodeId?: string
}

const MAX_STEPS = 1000

/** Where to start a walk: the trigger node, or an explicit node when resuming. */
function startNode(graph: WorkflowGraph, startNodeId?: string): WorkflowNode | undefined {
  if (startNodeId) return graph.nodes.find((n) => n.id === startNodeId)
  return graph.nodes.find((n) => n.type === 'trigger')
}

/** Follow the single successor of a node, or the branch-labeled one. */
function successorId(graph: WorkflowGraph, nodeId: string, branch?: string): string | undefined {
  const edge = graph.edges.find(
    (e) => e.from === nodeId && (branch === undefined ? !e.branch : e.branch === branch)
  )
  return edge?.to
}

/**
 * Walk the graph from the trigger (or `startNodeId` when resuming) collecting
 * actions until the end, a wait, or an unmatched branch/gate.
 */
export function walkWorkflow(
  graph: WorkflowGraph,
  ctx: ConditionContext,
  startNodeId?: string
): WalkResult {
  const actions: WorkflowAction[] = []
  const visited = new Set<string>()
  let node = startNode(graph, startNodeId)

  for (let step = 0; step < MAX_STEPS && node; step++) {
    // A cycle (or a re-entered node) ends the path rather than looping forever.
    if (visited.has(node.id)) return { actions, status: 'completed' }
    visited.add(node.id)

    let nextId: string | undefined
    switch (node.type) {
      case 'trigger':
        nextId = successorId(graph, node.id)
        break
      case 'action':
        actions.push(node.action)
        nextId = successorId(graph, node.id)
        break
      case 'condition':
        // A gate: continue only if it holds, else the path halts.
        if (!evaluateCondition(node.condition, ctx)) return { actions, status: 'halted' }
        nextId = successorId(graph, node.id)
        break
      case 'branch': {
        // First matching branch wins; none matching halts the path.
        const match = node.branches.find((b) => evaluateCondition(b.condition, ctx))
        if (!match) return { actions, status: 'halted' }
        nextId = successorId(graph, node.id, match.key)
        break
      }
      case 'wait':
        // Pause here; resume from this wait's successor so we never re-wait.
        return {
          actions,
          status: 'waiting',
          waitSeconds: node.seconds,
          resumeNodeId: successorId(graph, node.id),
        }
    }

    node = nextId ? graph.nodes.find((n) => n.id === nextId) : undefined
  }

  return { actions, status: 'completed' }
}
