/**
 * Exhaustive unit coverage for the pure graph walker (§4.6, Slice 5c; Phase C
 * conversational block layer, slice C-1): linear action sequences, condition
 * gates, first-match branches, durable-wait splitting with resume, the
 * defensive terminations (missing edge, cycle), and the conversational block
 * kinds' park-then-resume-at-self semantics.
 */
import { describe, it, expect } from 'vitest'
import { walkWorkflow, type WorkflowGraph } from '../graph'
import type { ConditionContext, BlockAnswer, AssistantOutcome } from '../condition.evaluator'
import { makeConditionContext } from './workflow-test-utils'

// This suite only ever branches on conversation.priority and ticket.type (see
// every `field:` literal below), so the shared builder's
// message/person/company/attributes defaults are inert here — passed through
// unread, same as a hand-rolled literal omitting them entirely would be.
const ctx = (over: Partial<ConditionContext['conversation']> = {}): ConditionContext =>
  makeConditionContext({
    conversation: {
      status: 'open',
      channel: 'messenger',
      priority: 'high',
      waitingMinutes: 10,
      tagIds: [],
      assignedTeamId: null,
      ...over,
    },
  })

const ctxWithAnswer = (blockAnswer: BlockAnswer): ConditionContext => ({
  ...ctx(),
  blockAnswer,
})

const ctxWithAssistantOutcome = (assistantOutcome: AssistantOutcome): ConditionContext => ({
  ...ctx(),
  assistantOutcome,
})

const doc = { type: 'doc', content: [{ type: 'text', text: 'Hi there' }] }

describe('walkWorkflow', () => {
  it('collects a linear trigger -> action -> action path in order', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'a1', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
        { id: 'a2', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'a1' },
        { from: 'a1', to: 'a2' },
      ],
    }
    const res = walkWorkflow(graph, ctx())
    expect(res.status).toBe('completed')
    expect(res.actions).toEqual([{ type: 'set_priority', priority: 'urgent' }, { type: 'close' }])
  })

  it('a branch routes on the triggering ticket type, and halts when there is no ticket', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        {
          id: 'b',
          type: 'branch',
          branches: [
            { key: 'bug', condition: { field: 'ticket.type', op: 'eq', value: 'ticket_type_bug' } },
            {
              key: 'billing',
              condition: { field: 'ticket.type', op: 'eq', value: 'ticket_type_billing' },
            },
          ],
        },
        {
          id: 'a_bug',
          type: 'action',
          action: { type: 'assign_team', teamId: 'team_eng' as never },
        },
        {
          id: 'a_billing',
          type: 'action',
          action: { type: 'assign_team', teamId: 'team_finance' as never },
        },
      ],
      edges: [
        { from: 't', to: 'b' },
        { from: 'b', to: 'a_bug', branch: 'bug' },
        { from: 'b', to: 'a_billing', branch: 'billing' },
      ],
    }
    const withTicket = (ticket: ConditionContext['ticket']) => ({ ...ctx(), ticket })

    expect(walkWorkflow(graph, withTicket({ typeId: 'ticket_type_bug' }))).toMatchObject({
      status: 'completed',
      actions: [{ type: 'assign_team', teamId: 'team_eng' }],
    })
    expect(walkWorkflow(graph, withTicket({ typeId: 'ticket_type_billing' }))).toMatchObject({
      status: 'completed',
      actions: [{ type: 'assign_team', teamId: 'team_finance' }],
    })
    // No paired ticket at all (a conversation trigger, or a ticket-less
    // conversation): every path is a non-match, so the walk halts rather than
    // falling into an arbitrary branch.
    expect(walkWorkflow(graph, withTicket(null))).toMatchObject({ status: 'halted' })
  })

  it('a condition gate continues when it holds and halts when it does not', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        {
          id: 'g',
          type: 'condition',
          condition: { field: 'conversation.priority', op: 'eq', value: 'high' },
        },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'g' },
        { from: 'g', to: 'a' },
      ],
    }
    expect(walkWorkflow(graph, ctx({ priority: 'high' }))).toMatchObject({
      status: 'completed',
      actions: [{ type: 'close' }],
    })
    expect(walkWorkflow(graph, ctx({ priority: 'low' }))).toMatchObject({
      status: 'halted',
      actions: [],
    })
  })

  it('a branch takes the first matching path; unmatched halts', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        {
          id: 'b',
          type: 'branch',
          branches: [
            {
              key: 'vip',
              condition: { field: 'conversation.priority', op: 'eq', value: 'urgent' },
            },
            {
              key: 'normal',
              condition: { field: 'conversation.priority', op: 'eq', value: 'high' },
            },
          ],
        },
        {
          id: 'a_vip',
          type: 'action',
          action: { type: 'assign_team', teamId: 'team_vip' as never },
        },
        { id: 'a_norm', type: 'action', action: { type: 'add_tag', tagId: 'ctag_std' as never } },
      ],
      edges: [
        { from: 't', to: 'b' },
        { from: 'b', to: 'a_vip', branch: 'vip' },
        { from: 'b', to: 'a_norm', branch: 'normal' },
      ],
    }
    // priority high -> 'vip' fails, 'normal' matches -> normal path.
    expect(walkWorkflow(graph, ctx({ priority: 'high' }))).toMatchObject({
      status: 'completed',
      actions: [{ type: 'add_tag', tagId: 'ctag_std' }],
    })
    // priority urgent -> 'vip' matches first.
    expect(walkWorkflow(graph, ctx({ priority: 'urgent' }))).toMatchObject({
      status: 'completed',
      actions: [{ type: 'assign_team', teamId: 'team_vip' }],
    })
    // priority low -> neither matches -> halt.
    expect(walkWorkflow(graph, ctx({ priority: 'low' }))).toMatchObject({ status: 'halted' })
  })

  it('splits at a wait and resumes from the wait successor (no re-wait)', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'a1', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
        { id: 'w', type: 'wait', seconds: 3600 },
        { id: 'a2', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'a1' },
        { from: 'a1', to: 'w' },
        { from: 'w', to: 'a2' },
      ],
    }
    const first = walkWorkflow(graph, ctx())
    expect(first).toMatchObject({
      status: 'waiting',
      waitSeconds: 3600,
      resumeNodeId: 'a2',
      actions: [{ type: 'set_priority', priority: 'urgent' }],
    })
    // Resume from a2 -> runs the tail, no re-wait.
    const resumed = walkWorkflow(graph, ctx(), first.resumeNodeId)
    expect(resumed).toMatchObject({ status: 'completed', actions: [{ type: 'close' }] })
  })

  it('terminates on a missing successor and on a cycle', () => {
    const dangling: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [{ from: 't', to: 'a' }], // a has no successor
    }
    expect(walkWorkflow(dangling, ctx())).toMatchObject({
      status: 'completed',
      actions: [{ type: 'close' }],
    })

    const cyclic: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'a' },
        { from: 'a', to: 't' }, // back to trigger
      ],
    }
    // Runs the action once, then the revisit ends the walk.
    expect(walkWorkflow(cyclic, ctx())).toMatchObject({
      status: 'completed',
      actions: [{ type: 'close' }],
    })
  })
})

describe('walkWorkflow — conversational block kinds (Phase C, slice C-1)', () => {
  it('stamps send_webhook actions with their graph node id for delivery dedupe', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        {
          id: 'webhook_action',
          type: 'action',
          action: { type: 'send_webhook', url: 'https://example.test/hook' },
        },
      ],
      edges: [{ from: 't', to: 'webhook_action' }],
    }
    expect(walkWorkflow(graph, ctx())).toMatchObject({
      status: 'completed',
      actions: [
        {
          type: 'send_webhook',
          url: 'https://example.test/hook',
          nodeId: 'webhook_action',
        },
      ],
    })
  })

  it('message and show_reply_time are SEND kinds: push one action and continue immediately', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'm', type: 'message', body: doc },
        { id: 'r', type: 'show_reply_time' },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'm' },
        { from: 'm', to: 'r' },
        { from: 'r', to: 'a' },
      ],
    }
    expect(walkWorkflow(graph, ctx())).toMatchObject({
      status: 'completed',
      actions: [
        { type: 'send_block', nodeId: 'm', block: { kind: 'message', body: doc } },
        { type: 'send_block', nodeId: 'r', block: { kind: 'replyTime' } },
        { type: 'close' },
      ],
    })
  })

  describe("let_assistant_answer (Phase C, slice C-6: parks pending Quinn's outcome)", () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'la', type: 'let_assistant_answer', instructions: 'Focus on billing only' },
        { id: 'a_default', type: 'action', action: { type: 'close' } },
        {
          id: 'a_escalated',
          type: 'action',
          action: { type: 'assign_team', teamId: 'team_x' as never },
        },
      ],
      edges: [
        { from: 't', to: 'la' },
        { from: 'la', to: 'a_default' },
        { from: 'la', to: 'a_escalated', branch: 'escalated' },
      ],
    }

    it('reached fresh: pushes its action (carrying instructions) and PARKS with waitKind assistant, resumeNodeId = its own id', () => {
      expect(walkWorkflow(graph, ctx())).toMatchObject({
        status: 'waiting',
        waitKind: 'assistant',
        resumeNodeId: 'la',
        actions: [{ type: 'let_assistant_answer', instructions: 'Focus on billing only' }],
      })
    })

    it('resumed with outcome "escalated": follows the labeled escalated edge', () => {
      const resumed = walkWorkflow(graph, ctxWithAssistantOutcome('escalated'), 'la')
      expect(resumed).toMatchObject({
        status: 'completed',
        actions: [{ type: 'assign_team', teamId: 'team_x' }],
      })
    })

    it('resumed with outcome "resolved": follows the unlabeled default edge', () => {
      const resumed = walkWorkflow(graph, ctxWithAssistantOutcome('resolved'), 'la')
      expect(resumed).toMatchObject({
        status: 'completed',
        actions: [{ type: 'close' }],
      })
    })

    it('resumed "escalated" with no escalated edge wired: ends the path rather than guessing (no fallback to default)', () => {
      const noEscalated: WorkflowGraph = {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'la', type: 'let_assistant_answer' },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'la' },
          { from: 'la', to: 'a' },
        ],
      }
      const resumed = walkWorkflow(noEscalated, ctxWithAssistantOutcome('escalated'), 'la')
      expect(resumed).toMatchObject({ status: 'completed', actions: [] })
    })
  })

  it('disable_composer is a runtime no-op pass-through: no action pushed', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'dc', type: 'disable_composer' },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'dc' },
        { from: 'dc', to: 'a' },
      ],
    }
    expect(walkWorkflow(graph, ctx())).toMatchObject({
      status: 'completed',
      actions: [{ type: 'close' }],
    })
  })

  describe('reply_buttons', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        {
          id: 'b',
          type: 'reply_buttons',
          body: doc,
          options: [
            { key: 'yes', label: 'Yes' },
            { key: 'no', label: 'No' },
          ],
          allowTyping: false,
        },
        { id: 'a_yes', type: 'action', action: { type: 'add_tag', tagId: 'ctag_yes' as never } },
        { id: 'a_no', type: 'action', action: { type: 'add_tag', tagId: 'ctag_no' as never } },
      ],
      edges: [
        { from: 't', to: 'b' },
        { from: 'b', to: 'a_yes', branch: 'yes' },
        { from: 'b', to: 'a_no', branch: 'no' },
      ],
    }

    it('reached fresh: parks with an input wait, resumeNodeId = its own id, and pushes the send_block action', () => {
      expect(walkWorkflow(graph, ctx())).toMatchObject({
        status: 'waiting',
        waitKind: 'input',
        resumeNodeId: 'b',
        blockKind: 'buttons',
        allowTypingInterrupt: false,
        actions: [
          {
            type: 'send_block',
            nodeId: 'b',
            block: {
              kind: 'buttons',
              options: [
                { key: 'yes', label: 'Yes' },
                { key: 'no', label: 'No' },
              ],
            },
          },
        ],
      })
    })

    it('resumed with a matching buttonKey: picks the outgoing edge for that branch (no send_block pushed)', () => {
      const resumed = walkWorkflow(graph, ctxWithAnswer({ kind: 'buttons', buttonKey: 'no' }), 'b')
      expect(resumed).toMatchObject({
        status: 'completed',
        actions: [{ type: 'add_tag', tagId: 'ctag_no' }],
      })
    })

    it('resumed with a buttonKey that has no matching edge: ends the path (stale graph edit)', () => {
      const resumed = walkWorkflow(
        graph,
        ctxWithAnswer({ kind: 'buttons', buttonKey: 'maybe' }),
        'b'
      )
      expect(resumed).toMatchObject({ status: 'completed', actions: [] })
    })
  })

  describe('collect_data', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        {
          id: 'c',
          type: 'collect_data',
          body: doc,
          attributeKey: 'email',
          fieldType: 'text',
          required: true,
        },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'c' },
        { from: 'c', to: 'a' },
      ],
    }

    it('reached fresh: parks with allowTypingInterrupt always true (composer stays enabled)', () => {
      expect(walkWorkflow(graph, ctx())).toMatchObject({
        status: 'waiting',
        waitKind: 'input',
        resumeNodeId: 'c',
        blockKind: 'collect',
        allowTypingInterrupt: true,
        actions: [
          { type: 'send_block', nodeId: 'c', block: { kind: 'collect', attributeKey: 'email' } },
        ],
      })
    })

    it('resumed with an answer: pushes a customer-sourced set_attribute then follows the single successor', () => {
      const resumed = walkWorkflow(graph, ctxWithAnswer({ kind: 'collect', value: 'a@b.com' }), 'c')
      expect(resumed).toMatchObject({
        status: 'completed',
        actions: [
          { type: 'set_attribute', key: 'email', value: 'a@b.com', src: 'customer' },
          { type: 'close' },
        ],
      })
    })
  })

  describe('collect_reply', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'c', type: 'collect_reply', body: doc, attributeKey: 'feedback' },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'c' },
        { from: 'c', to: 'a' },
      ],
    }

    it('reached fresh: parks awaiting the customer’s free-text reply', () => {
      expect(walkWorkflow(graph, ctx())).toMatchObject({
        status: 'waiting',
        waitKind: 'input',
        resumeNodeId: 'c',
        blockKind: 'collectReply',
        allowTypingInterrupt: true,
      })
    })

    it('resumed: writes the attribute (src customer) and follows the successor', () => {
      const resumed = walkWorkflow(
        graph,
        ctxWithAnswer({ kind: 'collectReply', value: 'Loved it' }),
        'c'
      )
      expect(resumed).toMatchObject({
        status: 'completed',
        actions: [
          { type: 'set_attribute', key: 'feedback', value: 'Loved it', src: 'customer' },
          { type: 'close' },
        ],
      })
    })
  })

  describe('request_csat', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'trigger' },
        {
          id: 'csat',
          type: 'request_csat',
          body: doc,
          allowTypingInterrupt: true,
          commentPrompt: 'Add a comment',
        },
        { id: 'a_low', type: 'action', action: { type: 'assign_team', teamId: 'team_x' as never } },
        { id: 'a_high', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'csat' },
        { from: 'csat', to: 'a_low', branch: '1' },
        { from: 'csat', to: 'a_high', branch: '5' },
      ],
    }

    it('reached fresh: parks with the configured allowTypingInterrupt', () => {
      expect(walkWorkflow(graph, ctx())).toMatchObject({
        status: 'waiting',
        waitKind: 'input',
        resumeNodeId: 'csat',
        blockKind: 'csat',
        allowTypingInterrupt: true,
        actions: [
          {
            type: 'send_block',
            nodeId: 'csat',
            block: { kind: 'csat', allowTypingInterrupt: true, commentPrompt: 'Add a comment' },
          },
        ],
      })
    })

    it('resumed with a rating: pushes record_csat then branches on String(rating)', () => {
      const low = walkWorkflow(graph, ctxWithAnswer({ kind: 'csat', rating: 1 }), 'csat')
      expect(low).toMatchObject({
        status: 'completed',
        actions: [
          { type: 'record_csat', rating: 1, comment: undefined },
          { type: 'assign_team', teamId: 'team_x' },
        ],
      })

      const high = walkWorkflow(
        graph,
        ctxWithAnswer({ kind: 'csat', rating: 5, comment: 'Great!' }),
        'csat'
      )
      expect(high).toMatchObject({
        status: 'completed',
        actions: [{ type: 'record_csat', rating: 5, comment: 'Great!' }, { type: 'close' }],
      })
    })

    it('resumed with a rating that has no matching branch edge: still records the rating, then ends the path', () => {
      const resumed = walkWorkflow(graph, ctxWithAnswer({ kind: 'csat', rating: 3 }), 'csat')
      expect(resumed).toMatchObject({
        status: 'completed',
        actions: [{ type: 'record_csat', rating: 3 }],
      })
    })
  })

  describe('consume-once semantics: a resume answer only routes the ONE node it targets', () => {
    it('two sequential reply_buttons: resume routes the first, then parks fresh at the second with its own send_block', () => {
      const graph: WorkflowGraph = {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'b1',
            type: 'reply_buttons',
            body: doc,
            options: [
              { key: 'yes', label: 'Yes' },
              { key: 'no', label: 'No' },
            ],
            allowTyping: false,
          },
          {
            id: 'b2',
            type: 'reply_buttons',
            body: doc,
            options: [
              { key: 'yes', label: 'Yes' },
              { key: 'no', label: 'No' },
            ],
            allowTyping: false,
          },
          { id: 'a_done', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'b1' },
          { from: 'b1', to: 'b2', branch: 'yes' },
          { from: 'b2', to: 'a_done', branch: 'yes' },
        ],
      }

      // Resuming at b1 with a 'yes' answer must route past b1 to b2 — and NOT
      // let that same answer also satisfy b2, which has never been asked yet.
      const resumed = walkWorkflow(
        graph,
        ctxWithAnswer({ kind: 'buttons', buttonKey: 'yes' }),
        'b1'
      )
      expect(resumed).toMatchObject({
        status: 'waiting',
        waitKind: 'input',
        resumeNodeId: 'b2',
        blockKind: 'buttons',
        actions: [{ type: 'send_block', nodeId: 'b2', block: { kind: 'buttons' } }],
      })
    })

    it('two sequential let_assistant_answer: resume routes the first, then parks fresh at the second awaiting its own outcome', () => {
      const graph: WorkflowGraph = {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'la1', type: 'let_assistant_answer' },
          { id: 'la2', type: 'let_assistant_answer', instructions: 'second turn' },
          { id: 'a_done', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'la1' },
          { from: 'la1', to: 'la2' },
          { from: 'la2', to: 'a_done' },
        ],
      }

      // Resuming at la1 with 'resolved' must follow la1's default edge to la2
      // — and NOT also let that outcome satisfy la2, which hasn't parked yet.
      const resumed = walkWorkflow(graph, ctxWithAssistantOutcome('resolved'), 'la1')
      expect(resumed).toMatchObject({
        status: 'waiting',
        waitKind: 'assistant',
        resumeNodeId: 'la2',
        actions: [{ type: 'let_assistant_answer', instructions: 'second turn' }],
      })
    })
  })
})
