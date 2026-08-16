/**
 * The workflow graph model + walker (support platform §4.6, Slice 5c; Phase C
 * conversational block layer, slice C-1). A workflow stores its canvas as JSONB
 * `{ nodes, edges }`; this is the shape and the pure function that walks it. Given
 * a graph and a resolved ConditionContext it returns the ordered actions to run
 * now and where it stopped — the end, a durable wait (with the node to resume
 * from), or a halt at an unmatched branch/gate. It never touches the DB or runs
 * actions: the engine executes the returned plan and, on a wait, persists the
 * resume node in the run cursor.
 *
 * Node kinds: trigger (entry), action (a catalogue action), condition (a gate:
 * continue only if it holds), branch (first matching path wins), wait (pause N
 * seconds, then resume). The walk is defensive — a missing edge/node ends the
 * path, and a visited-set + step cap make a malformed cyclic graph terminate.
 *
 * Conversational block kinds (Phase C): message / show_reply_time /
 * disable_composer are SEND (or pass-through) kinds — they push at most one
 * action and continue immediately, same as an `action` node. reply_buttons /
 * collect_data / collect_reply / request_csat are INTERACTIVE kinds: reached
 * fresh (ctx.blockAnswer absent), each pushes a `send_block` action describing
 * what to post and PARKS the walk (status 'waiting', waitKind 'input',
 * resumeNodeId = the node's OWN id — unlike a timer wait, an input wait
 * resumes AT itself, not at its successor). resumeWorkflowRun re-walks
 * starting at that same node with ctx.blockAnswer now populated from the
 * customer's matched reply; each interactive kind then routes (reply_buttons:
 * the outgoing edge whose `branch` equals the answered buttonKey, reusing
 * branch-edge matching verbatim; collect_data/collect_reply: push a
 * customer-sourced set_attribute action then follow the single successor;
 * request_csat: push a record_csat action then branch on String(rating) via
 * the same branch-edge matching) and continues past it — ctx.blockAnswer is
 * only ever populated on that exact resume walk (the fresh walk that first
 * reaches the node has no blockAnswer in scope), so the two cases can never
 * be confused.
 *
 * Consume-once resume answers: `ctx.blockAnswer`/`ctx.assistantOutcome` are
 * captured into a LOCAL at the top of `walkWorkflow` and cleared the instant
 * the one node they target consumes them. A resume walk that routes past its
 * target node can still reach a SECOND node of the same kind later in the
 * same walk (e.g. two sequential `reply_buttons` steps) — without consume-
 * once, that second node would see the same still-populated `ctx.blockAnswer`
 * and wrongly treat itself as already answered, routing straight past it
 * instead of parking to ask its own question. Once consumed, the local is
 * nulled, so that second same-kind node always takes the fresh-visit park
 * path, same as if this were a brand new walk.
 *
 * `let_assistant_answer` (slice C-6) is its own third PARKING kind, alongside
 * the interactive ones above rather than a SEND kind as slice C-1 first had
 * it: reached fresh, it pushes the `let_assistant_answer` action (invokes
 * Quinn's turn out-of-band, same as before) and PARKS (waitKind 'assistant',
 * resumeNodeId = its own id) — no message of its own, so no send_block, but
 * still a park: nothing else can resume this node until event-trigger.ts
 * hears back from Quinn (assistant.handed_off) or the conversation closes
 * while parked. On resume, ctx.assistantOutcome (not blockAnswer — a
 * different node kind, a different resume signal) selects the edge:
 * 'escalated' follows the labeled 'escalated' branch edge (same edge-key
 * matching every other kind here uses; no matching edge ends the path rather
 * than guessing, exactly like an unwired reply_buttons/request_csat branch),
 * 'resolved' follows the unlabeled default edge.
 */
import type { WorkflowAction } from './action.executor'
import type {
  WorkflowBlockKind,
  WorkflowBlockButtonOption,
  WorkflowBlockAttributeOption,
} from '@/lib/server/db'
import type { TiptapContent } from '@/lib/shared/db-types'
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
  // Conversational block kinds (Phase C, slice C-1) — see the module doc.
  | { id: string; type: 'message'; body: TiptapContent }
  // The ticket intake form as an in-thread block: posts the form card into
  // the conversation (visitor files the ticket in-thread — the widget renders
  // the intake form for block.kind 'ticketForm') and continues immediately,
  // same SEND-and-continue shape as `message` above.
  | { id: string; type: 'send_ticket_form'; body: TiptapContent }
  | { id: string; type: 'show_reply_time' }
  | {
      id: string
      type: 'let_assistant_answer'
      /** Phase C, slice C-6: a one-time instruction folded into just this
       *  turn's system prompt (see assistant.runtime.ts's
       *  buildStepInstructionsPrompt) — never persisted config, never read
       *  outside this one action.executor.ts call. */
      instructions?: string
    }
  | { id: string; type: 'disable_composer' }
  | {
      id: string
      type: 'reply_buttons'
      body: TiptapContent
      options: WorkflowBlockButtonOption[]
      allowTyping: boolean
    }
  | {
      id: string
      type: 'collect_data'
      body: TiptapContent
      attributeKey: string
      fieldType: 'text' | 'number' | 'select' | 'date'
      options?: WorkflowBlockAttributeOption[]
      required: boolean
    }
  | { id: string; type: 'collect_reply'; body: TiptapContent; attributeKey: string }
  | {
      id: string
      type: 'request_csat'
      body: TiptapContent
      allowTypingInterrupt: boolean
      commentPrompt?: string
    }

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
  /** Seconds to wait (status = waiting, waitKind = 'timer'). */
  waitSeconds?: number
  /** The node to resume from after the wait (status = waiting). For a timer
   *  wait this is the wait's successor, so resuming never re-waits. For an
   *  input wait this is the interactive node's OWN id, so resuming re-enters
   *  it with the answer in scope. Undefined if a timer wait has no successor
   *  (treated as completed-after-wait). */
  resumeNodeId?: string
  /** 'timer' = a plain `wait` node (the existing durable BullMQ timer);
   *  'input' = an interactive block parked awaiting the customer's structured
   *  reply (no timer — resumed by event-trigger.ts on a matching reply);
   *  'assistant' = a `let_assistant_answer` parked awaiting Quinn's own
   *  outcome (no timer either — resumed by event-trigger.ts on
   *  assistant.handed_off or the conversation closing, see graph.ts's module
   *  doc). Undefined when status !== 'waiting'. */
  waitKind?: 'timer' | 'input' | 'assistant'
  /** Set alongside waitKind 'input' — the block kind the engine stamps onto
   *  the InputWaitCursor. */
  blockKind?: WorkflowBlockKind
  /** Set alongside waitKind 'input' — whether free-typed text is allowed
   *  alongside the interactive affordance (baked into the cursor at park
   *  time so the hot resume path never re-reads the graph). */
  allowTypingInterrupt?: boolean
}

const MAX_STEPS = 1000

/** The labeled outgoing edge a let_assistant_answer node's escalated path
 *  carries — mirrors workflow-graph.ts's client-side LET_ASSISTANT_ESCALATED_KEY
 *  (same literal, not imported: that module is client-side and already
 *  hardcodes it too, same as every template's `branch: 'escalated'`). */
const LET_ASSISTANT_ESCALATED_BRANCH = 'escalated'

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
  // Consume-once locals — see the module doc's "Consume-once resume answers"
  // paragraph. Read from `ctx` exactly once, here, then cleared by whichever
  // case below actually consumes one, so a second node of the same kind
  // later in this same walk never mistakes itself for already answered.
  let blockAnswer = ctx.blockAnswer
  let assistantOutcome = ctx.assistantOutcome

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
        actions.push(
          node.action.type === 'send_webhook' ? { ...node.action, nodeId: node.id } : node.action
        )
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
          waitKind: 'timer',
          waitSeconds: node.seconds,
          resumeNodeId: successorId(graph, node.id),
        }

      // ── Conversational block kinds (Phase C, slice C-1) ──────────────────
      case 'message':
        actions.push({
          type: 'send_block',
          nodeId: node.id,
          block: { kind: 'message', body: node.body },
        })
        nextId = successorId(graph, node.id)
        break

      case 'send_ticket_form':
        actions.push({
          type: 'send_block',
          nodeId: node.id,
          block: { kind: 'ticketForm', body: node.body },
        })
        nextId = successorId(graph, node.id)
        break

      case 'show_reply_time':
        actions.push({ type: 'send_block', nodeId: node.id, block: { kind: 'replyTime' } })
        nextId = successorId(graph, node.id)
        break

      case 'let_assistant_answer': {
        if (assistantOutcome) {
          // Resume: the outcome selects the edge — no message of its own, so
          // no send_block, just routing. No matching edge (an unwired
          // escalated path, or a stale graph edit) ends the path rather than
          // guessing, same contract as every other kind's resume above.
          nextId =
            assistantOutcome === 'escalated'
              ? successorId(graph, node.id, LET_ASSISTANT_ESCALATED_BRANCH)
              : successorId(graph, node.id)
          // Consume-once: a second let_assistant_answer node reached later in
          // this same walk must park fresh, not read this same outcome again.
          assistantOutcome = undefined
          break
        }
        // Fresh: invoke Quinn's turn (out-of-band, same as before) and PARK —
        // see the module doc for why this is a third parking kind, not a
        // pass-through SEND kind.
        actions.push({ type: 'let_assistant_answer', instructions: node.instructions })
        return {
          actions,
          status: 'waiting',
          waitKind: 'assistant',
          resumeNodeId: node.id,
        }
      }

      case 'disable_composer':
        // Builder sugar only: forces allowTyping:false semantics on the
        // adjacent interactive block at authoring time. A standalone
        // disable_composer (no adjacent interactive block) is a runtime
        // no-op per the contract's amendment 3 — nothing to push, just pass
        // through.
        nextId = successorId(graph, node.id)
        break

      case 'reply_buttons': {
        if (blockAnswer?.kind === 'buttons') {
          // Resume: pick the outgoing edge whose branch equals the answered
          // buttonKey — the same branch-edge matching a `branch` node uses.
          // No matching edge (e.g. a stale graph edit) ends the path rather
          // than guessing.
          nextId = successorId(graph, node.id, blockAnswer.buttonKey)
          // Consume-once: a second reply_buttons node later in this same walk
          // must park fresh, not reroute on this same answer again.
          blockAnswer = undefined
          break
        }
        actions.push({
          type: 'send_block',
          nodeId: node.id,
          block: {
            kind: 'buttons',
            body: node.body,
            options: node.options,
            allowTyping: node.allowTyping,
          },
        })
        return {
          actions,
          status: 'waiting',
          waitKind: 'input',
          resumeNodeId: node.id,
          blockKind: 'buttons',
          allowTypingInterrupt: node.allowTyping,
        }
      }

      case 'collect_data': {
        if (blockAnswer?.kind === 'collect') {
          // Resume: write the customer-sourced value then follow the single
          // successor (no branch-by-answer for a free-form collect).
          actions.push({
            type: 'set_attribute',
            key: node.attributeKey,
            value: blockAnswer.value,
            src: 'customer',
          })
          nextId = successorId(graph, node.id)
          // Consume-once: a second collect_data node later in this same walk
          // must park fresh, not write this same answer again.
          blockAnswer = undefined
          break
        }
        actions.push({
          type: 'send_block',
          nodeId: node.id,
          block: {
            kind: 'collect',
            body: node.body,
            attributeKey: node.attributeKey,
            fieldType: node.fieldType,
            options: node.options,
            required: node.required,
          },
        })
        return {
          actions,
          status: 'waiting',
          waitKind: 'input',
          resumeNodeId: node.id,
          blockKind: 'collect',
          // Collect blocks always leave the composer enabled; a non-matching
          // reply is an interrupt by design (per the contract's interrupt matrix).
          allowTypingInterrupt: true,
        }
      }

      case 'collect_reply': {
        if (blockAnswer?.kind === 'collectReply') {
          actions.push({
            type: 'set_attribute',
            key: node.attributeKey,
            value: blockAnswer.value,
            src: 'customer',
          })
          nextId = successorId(graph, node.id)
          // Consume-once: a second collect_reply node later in this same walk
          // must park fresh, not write this same answer again.
          blockAnswer = undefined
          break
        }
        actions.push({
          type: 'send_block',
          nodeId: node.id,
          block: { kind: 'collectReply', body: node.body, attributeKey: node.attributeKey },
        })
        return {
          actions,
          status: 'waiting',
          waitKind: 'input',
          resumeNodeId: node.id,
          blockKind: 'collectReply',
          allowTypingInterrupt: true,
        }
      }

      case 'request_csat': {
        if (blockAnswer?.kind === 'csat') {
          // Resume: record the rating (+ optional comment) then branch on
          // String(rating) — the same branch-edge matching a `branch` node
          // uses, keyed by the rating digit ("1".."5"). No matching edge ends
          // the path (the rating is still recorded either way).
          actions.push({
            type: 'record_csat',
            rating: blockAnswer.rating,
            comment: blockAnswer.comment,
          })
          nextId = successorId(graph, node.id, String(blockAnswer.rating))
          // Consume-once: a second request_csat node later in this same walk
          // must park fresh, not record this same rating again.
          blockAnswer = undefined
          break
        }
        actions.push({
          type: 'send_block',
          nodeId: node.id,
          block: {
            kind: 'csat',
            body: node.body,
            allowTypingInterrupt: node.allowTypingInterrupt,
            commentPrompt: node.commentPrompt,
          },
        })
        return {
          actions,
          status: 'waiting',
          waitKind: 'input',
          resumeNodeId: node.id,
          blockKind: 'csat',
          allowTypingInterrupt: node.allowTypingInterrupt,
        }
      }
    }

    node = nextId ? graph.nodes.find((n) => n.id === nextId) : undefined
  }

  return { actions, status: 'completed' }
}
