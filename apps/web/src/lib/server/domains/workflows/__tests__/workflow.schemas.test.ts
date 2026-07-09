/**
 * Coverage for the workflow graph validation (§4.6): a well-formed graph (every
 * node kind, nested conditions, the serializable snooze) passes, and the common
 * malformations are rejected at the boundary instead of stored.
 */
import { describe, it, expect } from 'vitest'
import { workflowGraphSchema } from '../workflow.schemas'

describe('workflowGraphSchema', () => {
  it('accepts a full graph across every node kind', () => {
    const graph = {
      nodes: [
        { id: 't', type: 'trigger' },
        {
          id: 'g',
          type: 'condition',
          condition: {
            all: [
              { field: 'conversation.priority', op: 'eq', value: 'high' },
              { any: [{ field: 'message.sender', op: 'eq', value: 'visitor' }] },
            ],
          },
        },
        {
          id: 'b',
          type: 'branch',
          branches: [
            {
              key: 'vip',
              condition: { field: 'conversation.tags', op: 'includes_any', value: ['x'] },
            },
          ],
        },
        { id: 'a1', type: 'action', action: { type: 'assign_team', teamId: 'team_1' } },
        {
          id: 'a2',
          type: 'action',
          action: { type: 'snooze', untilIso: '2026-01-06T09:00:00.000Z' },
        },
        { id: 'a3', type: 'action', action: { type: 'snooze', untilIso: null } },
        { id: 'w', type: 'wait', seconds: 3600 },
      ],
      edges: [
        { from: 't', to: 'g' },
        { from: 'b', to: 'a1', branch: 'vip' },
      ],
    }
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
  })

  it('rejects an unknown action type, a bad snooze, and a negative wait', () => {
    const badAction = {
      nodes: [{ id: 'a', type: 'action', action: { type: 'launch_missiles' } }],
      edges: [],
    }
    expect(workflowGraphSchema.safeParse(badAction).success).toBe(false)

    const badSnooze = {
      nodes: [{ id: 'a', type: 'action', action: { type: 'snooze', untilIso: 'not-a-date' } }],
      edges: [],
    }
    expect(workflowGraphSchema.safeParse(badSnooze).success).toBe(false)

    const badWait = {
      nodes: [{ id: 'w', type: 'wait', seconds: -5 }],
      edges: [],
    }
    expect(workflowGraphSchema.safeParse(badWait).success).toBe(false)
  })

  it('accepts a conversation.team condition', () => {
    const graph = {
      nodes: [
        {
          id: 'g',
          type: 'condition',
          condition: { field: 'conversation.team', op: 'eq', value: 'team_1' },
        },
      ],
      edges: [],
    }
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
  })

  it('rejects a condition with a typo/unknown field', () => {
    const typo = {
      nodes: [
        {
          id: 'g',
          type: 'condition',
          condition: { field: 'conversation.stattus', op: 'eq', value: 'open' },
        },
      ],
      edges: [],
    }
    expect(workflowGraphSchema.safeParse(typo).success).toBe(false)
  })

  it('rejects a node missing its id and a malformed edge', () => {
    const noId = { nodes: [{ type: 'trigger' }], edges: [] }
    expect(workflowGraphSchema.safeParse(noId).success).toBe(false)

    const badEdge = { nodes: [], edges: [{ from: 't' }] }
    expect(workflowGraphSchema.safeParse(badEdge).success).toBe(false)
  })
})
