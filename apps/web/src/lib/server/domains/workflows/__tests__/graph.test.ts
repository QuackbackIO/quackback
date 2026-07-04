/**
 * Exhaustive unit coverage for the pure graph walker (§4.6, Slice 5c): linear
 * action sequences, condition gates, first-match branches, durable-wait splitting
 * with resume, and the defensive terminations (missing edge, cycle).
 */
import { describe, it, expect } from 'vitest'
import { walkWorkflow, type WorkflowGraph } from '../graph'
import type { ConditionContext } from '../condition.evaluator'

const ctx = (over: Partial<ConditionContext['conversation']> = {}): ConditionContext => ({
  conversation: {
    status: 'open',
    channel: 'messenger',
    priority: 'high',
    waitingMinutes: 10,
    tagIds: [],
    ...over,
  },
})

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
