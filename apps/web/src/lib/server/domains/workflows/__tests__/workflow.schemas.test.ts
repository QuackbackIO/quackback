/**
 * Coverage for the workflow graph validation (§4.6): a well-formed graph (every
 * node kind, nested conditions, the serializable snooze) passes, and the common
 * malformations are rejected at the boundary instead of stored.
 *
 * Calibration coverage: the "certainly broken at runtime" rejections (duplicate
 * ids, dangling edges, an over-long wait, an undeclared branch key) each get a
 * reject case AND an accept-at-the-boundary case; the deliberately-tolerated
 * shapes (multiple/zero triggers, cycles, unreachable nodes, needs-setup
 * placeholders) each get a regression guard proving they are NOT rejected — the
 * "Edit as JSON" mode and the runtime walker both depend on that staying true.
 */
import { describe, it, expect } from 'vitest'
import {
  workflowGraphSchema,
  triggerTypeSchema,
  triggerSettingsSchema,
  MAX_WAIT_SECONDS,
  MAX_INACTIVITY_MINUTES,
  MAX_BREACH_LEAD_MINUTES,
  MIN_CALL_CONNECTOR_TIMEOUT_MS,
  MAX_CALL_CONNECTOR_TIMEOUT_MS,
  CALL_CONNECTOR_FAILED_KEY,
  duplicateStepIdMessage,
  missingStepMessage,
  undeclaredBranchPathMessage,
  classRestrictedNodeIssue,
} from '../workflow.schemas'
import { MAX_CONVERSATION_MESSAGE_LENGTH } from '@/lib/shared/conversation/types'

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

  // Phase C conversational block layer (slice C-1).
  describe('conversational block node kinds', () => {
    const body = { type: 'doc', content: [{ type: 'text', text: 'Hi {first_name}!' }] }

    it('accepts every block node kind', () => {
      const graph = {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'msg', type: 'message', body },
          { id: 'rt', type: 'show_reply_time' },
          { id: 'la', type: 'let_assistant_answer' },
          { id: 'dc', type: 'disable_composer' },
          {
            id: 'btn',
            type: 'reply_buttons',
            body,
            options: [{ key: 'yes', label: 'Yes' }],
            allowTyping: false,
          },
          {
            id: 'cd',
            type: 'collect_data',
            body,
            attributeKey: 'email',
            fieldType: 'text',
            required: true,
          },
          { id: 'cr', type: 'collect_reply', body, attributeKey: 'feedback' },
          {
            id: 'csat',
            type: 'request_csat',
            body,
            allowTypingInterrupt: true,
            commentPrompt: 'Add a comment',
          },
        ],
        edges: [
          { from: 't', to: 'msg' },
          { from: 'btn', to: 'cd', branch: 'yes' },
        ],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
    })

    it('accepts a collect_data node with no options (a text/number/date field has none)', () => {
      const graph = {
        nodes: [
          {
            id: 'cd',
            type: 'collect_data',
            body,
            attributeKey: 'email',
            fieldType: 'text',
            required: false,
          },
        ],
        edges: [],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
    })

    it('rejects a reply_buttons node with zero options: unusable at runtime', () => {
      const graph = {
        nodes: [{ id: 'btn', type: 'reply_buttons', body, options: [], allowTyping: false }],
        edges: [],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(false)
    })

    it('rejects a block body missing entirely, and a malformed body shape', () => {
      const missing = { nodes: [{ id: 'msg', type: 'message' }], edges: [] }
      expect(workflowGraphSchema.safeParse(missing).success).toBe(false)

      const malformed = { nodes: [{ id: 'msg', type: 'message', body: 'not a doc' }], edges: [] }
      expect(workflowGraphSchema.safeParse(malformed).success).toBe(false)
    })

    it('rejects a collect_data node missing its attributeKey or fieldType', () => {
      const noKey = {
        nodes: [{ id: 'cd', type: 'collect_data', body, fieldType: 'text', required: true }],
        edges: [],
      }
      expect(workflowGraphSchema.safeParse(noKey).success).toBe(false)

      const badFieldType = {
        nodes: [
          {
            id: 'cd',
            type: 'collect_data',
            body,
            attributeKey: 'email',
            fieldType: 'bogus',
            required: true,
          },
        ],
        edges: [],
      }
      expect(workflowGraphSchema.safeParse(badFieldType).success).toBe(false)
    })

    it('let_assistant_answer (Phase C, slice C-6): accepts instructions + autoCloseOverride, rejects instructions past the bound', () => {
      const withFields = {
        nodes: [
          {
            id: 'la',
            type: 'let_assistant_answer',
            instructions: 'Focus on billing only',
            autoCloseOverride: true,
          },
        ],
        edges: [],
      }
      expect(workflowGraphSchema.safeParse(withFields).success).toBe(true)

      const tooLong = {
        nodes: [{ id: 'la', type: 'let_assistant_answer', instructions: 'x'.repeat(2001) }],
        edges: [],
      }
      expect(workflowGraphSchema.safeParse(tooLong).success).toBe(false)
    })

    it('JSON-mode tolerance: a block node still tolerates a dangling/unlabeled edge the same as every other kind (structural checks only)', () => {
      // Two message nodes, no edge between them at all — the walker (graph.ts)
      // just ends the path early; save-validation doesn't reject an
      // unreachable/disconnected node, mirroring the module's stated
      // calibration for every other node kind.
      const graph = {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'msg1', type: 'message', body },
          { id: 'msg2', type: 'message', body },
        ],
        edges: [{ from: 't', to: 'msg1' }],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
    })
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

  it('accepts person.email', () => {
    const graph = {
      nodes: [
        {
          id: 'g',
          type: 'condition',
          condition: { field: 'person.email', op: 'contains', value: '@example.com' },
        },
      ],
      edges: [],
    }
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
  })

  it('accepts person.attr.<key> and company.attr.<key> for any non-empty key', () => {
    const graph = {
      nodes: [
        {
          id: 'g',
          type: 'condition',
          condition: {
            all: [
              { field: 'person.attr.plan', op: 'eq', value: 'enterprise' },
              { field: 'company.attr.tier', op: 'eq', value: 'gold' },
            ],
          },
        },
      ],
      edges: [],
    }
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
  })

  it('rejects an empty person.attr./company.attr. key and unrelated lookalike prefixes', () => {
    for (const field of ['person.attr.', 'company.attr.', 'person.attrs.plan', 'person.stattus']) {
      const graph = {
        nodes: [{ id: 'g', type: 'condition', condition: { field, op: 'eq', value: 'x' } }],
        edges: [],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(false)
    }
  })

  it('rejects a node missing its id and a malformed edge', () => {
    const noId = { nodes: [{ type: 'trigger' }], edges: [] }
    expect(workflowGraphSchema.safeParse(noId).success).toBe(false)

    const badEdge = { nodes: [], edges: [{ from: 't' }] }
    expect(workflowGraphSchema.safeParse(badEdge).success).toBe(false)
  })

  it('rejects two steps sharing an id', () => {
    const dup = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 't', type: 'action', action: { type: 'close' } },
      ],
      edges: [],
    }
    expect(workflowGraphSchema.safeParse(dup).success).toBe(false)
  })

  it('rejects an edge whose "from" or "to" references a step id that does not exist', () => {
    const missingFrom = {
      nodes: [{ id: 't', type: 'trigger' }],
      edges: [{ from: 'ghost', to: 't' }],
    }
    expect(workflowGraphSchema.safeParse(missingFrom).success).toBe(false)

    const missingTo = {
      nodes: [{ id: 't', type: 'trigger' }],
      edges: [{ from: 't', to: 'ghost' }],
    }
    expect(workflowGraphSchema.safeParse(missingTo).success).toBe(false)
  })

  it('accepts a wait exactly at MAX_WAIT_SECONDS and rejects one second over', () => {
    const atBound = { nodes: [{ id: 'w', type: 'wait', seconds: MAX_WAIT_SECONDS }], edges: [] }
    expect(workflowGraphSchema.safeParse(atBound).success).toBe(true)

    const overBound = {
      nodes: [{ id: 'w', type: 'wait', seconds: MAX_WAIT_SECONDS + 1 }],
      edges: [],
    }
    expect(workflowGraphSchema.safeParse(overBound).success).toBe(false)
  })

  it('rejects a branch edge whose "branch" key is not declared on the branch node', () => {
    const undeclaredKey = {
      nodes: [
        {
          id: 'b',
          type: 'branch',
          branches: [{ key: 'vip', condition: {} }],
        },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [{ from: 'b', to: 'a', branch: 'not_a_real_key' }],
    }
    expect(workflowGraphSchema.safeParse(undeclaredKey).success).toBe(false)
  })

  it('accepts a branch edge whose key matches a declared branch path', () => {
    const declaredKey = {
      nodes: [
        { id: 'b', type: 'branch', branches: [{ key: 'vip', condition: {} }] },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [{ from: 'b', to: 'a', branch: 'vip' }],
    }
    expect(workflowGraphSchema.safeParse(declaredKey).success).toBe(true)
  })

  // The builder's "Edit as JSON" mode is a deliberately lossless escape hatch:
  // it can store graphs the visual (tree) editor can't render, and the walker
  // (graph.ts) tolerates every one of these, so none is rejected here.
  describe('tolerates shapes the visual editor cannot render', () => {
    it('a graph with zero triggers (a still-draftable, not-yet-wired workflow)', () => {
      const noTrigger = {
        nodes: [{ id: 'a', type: 'action', action: { type: 'close' } }],
        edges: [],
      }
      expect(workflowGraphSchema.safeParse(noTrigger).success).toBe(true)
    })

    it('a graph with more than one trigger', () => {
      const twoTriggers = {
        nodes: [
          { id: 't1', type: 'trigger' },
          { id: 't2', type: 'trigger' },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't1', to: 'a' },
          { from: 't2', to: 'a' },
        ],
      }
      expect(workflowGraphSchema.safeParse(twoTriggers).success).toBe(true)
    })

    it('a graph containing a cycle', () => {
      const cyclic = {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'a', type: 'action', action: { type: 'close' } },
          { id: 'b', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'a' },
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' }, // a <-> b cycle
        ],
      }
      expect(workflowGraphSchema.safeParse(cyclic).success).toBe(true)
    })

    it('a graph with an unreachable (unconnected) node', () => {
      const orphan = {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'reachable', type: 'action', action: { type: 'close' } },
          { id: 'stranded', type: 'action', action: { type: 'close' } },
        ],
        edges: [{ from: 't', to: 'reachable' }],
      }
      expect(workflowGraphSchema.safeParse(orphan).success).toBe(true)
    })

    it('a needs-setup- placeholder ref on an action', () => {
      const needsSetup = {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'a',
            type: 'action',
            action: { type: 'assign_team', teamId: 'needs-setup-team' },
          },
        ],
        edges: [{ from: 't', to: 'a' }],
      }
      expect(workflowGraphSchema.safeParse(needsSetup).success).toBe(true)
    })

    it('an unlabeled edge leaving a branch node, and a branch path with no outgoing edge', () => {
      const danglingBranch = {
        nodes: [
          {
            id: 'b',
            type: 'branch',
            branches: [
              { key: 'has_edge', condition: {} },
              { key: 'no_edge', condition: {} },
            ],
          },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        // 'has_edge' is wired; 'no_edge' has no outgoing edge at all (fine —
        // the walker just ends the path there).
        edges: [{ from: 'b', to: 'a', branch: 'has_edge' }],
      }
      expect(workflowGraphSchema.safeParse(danglingBranch).success).toBe(true)
    })
  })
})

// These four structural checks are re-implemented client-side by
// validateGraph (workflow-graph.ts) so a JSON-mode graph gets a readable
// error before ever reaching the server. Both sides call the same exported
// builder so the wording can't drift the way it already had (capitalization,
// prefix); see the client test file for the matching assertions.
describe('shared structural-validation messages (kept in sync with validateGraph)', () => {
  it('duplicateStepIdMessage matches the superRefine issue for a duplicate node id', () => {
    const dup = {
      nodes: [
        { id: 'x', type: 'trigger' },
        { id: 'x', type: 'action', action: { type: 'close' } },
      ],
      edges: [],
    }
    const result = workflowGraphSchema.safeParse(dup)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(duplicateStepIdMessage('x'))
    }
  })

  it('missingStepMessage matches the superRefine issue for a dangling "from" and "to"', () => {
    const missingFrom = {
      nodes: [{ id: 't', type: 'trigger' }],
      edges: [{ from: 'ghost', to: 't' }],
    }
    const fromResult = workflowGraphSchema.safeParse(missingFrom)
    expect(fromResult.success).toBe(false)
    if (!fromResult.success) {
      expect(fromResult.error.issues[0]?.message).toBe(missingStepMessage('ghost'))
    }

    const missingTo = {
      nodes: [{ id: 't', type: 'trigger' }],
      edges: [{ from: 't', to: 'ghost' }],
    }
    const toResult = workflowGraphSchema.safeParse(missingTo)
    expect(toResult.success).toBe(false)
    if (!toResult.success) {
      expect(toResult.error.issues[0]?.message).toBe(missingStepMessage('ghost'))
    }
  })

  it('undeclaredBranchPathMessage matches the superRefine issue for an undeclared branch key', () => {
    const undeclaredKey = {
      nodes: [
        { id: 'b', type: 'branch', branches: [{ key: 'vip', condition: {} }] },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [{ from: 'b', to: 'a', branch: 'not_a_real_key' }],
    }
    const result = workflowGraphSchema.safeParse(undeclaredKey)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        undeclaredBranchPathMessage('b', 'not_a_real_key')
      )
    }
  })
})

describe('triggerTypeSchema', () => {
  it('accepts every dispatchable trigger type', () => {
    for (const t of [
      'conversation.created',
      'conversation.status_changed',
      'conversation.assigned',
      'conversation.priority_changed',
      'conversation.attribute_changed',
      'conversation.csat_submitted',
      'message.created',
      'message.note_created',
      'assistant.handed_off',
      'conversation.customer_unresponsive',
      'conversation.teammate_unresponsive',
      'sla.approaching_breach',
      'sla.breached',
    ]) {
      expect(triggerTypeSchema.safeParse(t).success).toBe(true)
    }
  })

  it("rejects an unknown or typo'd trigger type", () => {
    expect(triggerTypeSchema.safeParse('conversation.craeted').success).toBe(false)
    expect(triggerTypeSchema.safeParse('something.else').success).toBe(false)
    expect(triggerTypeSchema.safeParse('').success).toBe(false)
  })
})

describe('snooze action: relative + legacy', () => {
  const graphWithSnooze = (action: unknown) => ({
    nodes: [{ id: 'a', type: 'action', action }],
    edges: [],
  })

  it('accepts a relative snooze at 0 and at MAX_WAIT_SECONDS', () => {
    expect(
      workflowGraphSchema.safeParse(graphWithSnooze({ type: 'snooze', seconds: 0 })).success
    ).toBe(true)
    expect(
      workflowGraphSchema.safeParse(graphWithSnooze({ type: 'snooze', seconds: MAX_WAIT_SECONDS }))
        .success
    ).toBe(true)
  })

  it('rejects a relative snooze one second over MAX_WAIT_SECONDS, and a negative one', () => {
    expect(
      workflowGraphSchema.safeParse(
        graphWithSnooze({ type: 'snooze', seconds: MAX_WAIT_SECONDS + 1 })
      ).success
    ).toBe(false)
    expect(
      workflowGraphSchema.safeParse(graphWithSnooze({ type: 'snooze', seconds: -1 })).success
    ).toBe(false)
  })

  it('still accepts the legacy absolute form (a UTC timestamp, or null for "until reply")', () => {
    expect(
      workflowGraphSchema.safeParse(
        graphWithSnooze({ type: 'snooze', untilIso: '2026-08-01T09:00:00Z' })
      ).success
    ).toBe(true)
    expect(
      workflowGraphSchema.safeParse(graphWithSnooze({ type: 'snooze', untilIso: null })).success
    ).toBe(true)
  })

  it('rejects a snooze carrying both untilIso and seconds — ambiguous, matches neither branch', () => {
    const result = workflowGraphSchema.safeParse(
      graphWithSnooze({ type: 'snooze', untilIso: null, seconds: 60 })
    )
    expect(result.success).toBe(false)
  })

  it('rejects a snooze with neither untilIso nor seconds', () => {
    expect(workflowGraphSchema.safeParse(graphWithSnooze({ type: 'snooze' })).success).toBe(false)
  })
})

describe('add_note action', () => {
  const graphWithNote = (action: unknown) => ({
    nodes: [{ id: 'a', type: 'action', action }],
    edges: [],
  })

  it('accepts a non-empty plain-text body', () => {
    expect(
      workflowGraphSchema.safeParse(graphWithNote({ type: 'add_note', body: 'Escalated to VIP' }))
        .success
    ).toBe(true)
  })

  it('rejects an empty body', () => {
    expect(
      workflowGraphSchema.safeParse(graphWithNote({ type: 'add_note', body: '' })).success
    ).toBe(false)
  })

  it('rejects a body over MAX_CONVERSATION_MESSAGE_LENGTH, accepts one at the limit', () => {
    expect(
      workflowGraphSchema.safeParse(
        graphWithNote({ type: 'add_note', body: 'x'.repeat(MAX_CONVERSATION_MESSAGE_LENGTH + 1) })
      ).success
    ).toBe(false)
    expect(
      workflowGraphSchema.safeParse(
        graphWithNote({ type: 'add_note', body: 'x'.repeat(MAX_CONVERSATION_MESSAGE_LENGTH) })
      ).success
    ).toBe(true)
  })

  it('rejects a missing body', () => {
    expect(workflowGraphSchema.safeParse(graphWithNote({ type: 'add_note' })).success).toBe(false)
  })
})

describe('triggerSettingsSchema: frequencyCap', () => {
  it('stays an open bag when frequencyCap is absent — unrelated keys round-trip untouched', () => {
    const settings = { channels: ['email'], someFutureKey: 42 }
    const parsed = triggerSettingsSchema.parse(settings)
    expect(parsed).toEqual(settings)
  })

  it('accepts every frequencyCap variant within bounds', () => {
    for (const frequencyCap of [
      { type: 'unlimited' },
      { type: 'once' },
      { type: 'once_per_days', days: 1 },
      { type: 'once_per_days', days: 365 },
      { type: 'n_total', count: 1 },
      { type: 'n_total', count: 1000 },
    ]) {
      expect(triggerSettingsSchema.safeParse({ frequencyCap }).success).toBe(true)
    }
  })

  it('rejects a frequencyCap out of bounds (days/count at 0 or one past the ceiling)', () => {
    expect(
      triggerSettingsSchema.safeParse({ frequencyCap: { type: 'once_per_days', days: 0 } }).success
    ).toBe(false)
    expect(
      triggerSettingsSchema.safeParse({ frequencyCap: { type: 'once_per_days', days: 366 } })
        .success
    ).toBe(false)
    expect(
      triggerSettingsSchema.safeParse({ frequencyCap: { type: 'n_total', count: 0 } }).success
    ).toBe(false)
    expect(
      triggerSettingsSchema.safeParse({ frequencyCap: { type: 'n_total', count: 1001 } }).success
    ).toBe(false)
  })

  it('rejects an unknown frequencyCap type, but leaves other keys open to typos', () => {
    expect(triggerSettingsSchema.safeParse({ frequencyCap: { type: 'sometimes' } }).success).toBe(
      false
    )
    // Only the known `frequencyCap` key is shape-validated — every other key
    // in the bag, however misspelled, is a free-form pass-through.
    expect(triggerSettingsSchema.safeParse({ chanels: ['email'] }).success).toBe(true)
  })
})

describe('triggerSettingsSchema: audience', () => {
  it('accepts an absent audience, and a leaf/group condition in the exact conditionSchema shape', () => {
    expect(triggerSettingsSchema.safeParse({}).success).toBe(true)
    expect(
      triggerSettingsSchema.safeParse({
        audience: { field: 'conversation.status', op: 'eq', value: 'open' },
      }).success
    ).toBe(true)
    expect(
      triggerSettingsSchema.safeParse({
        audience: {
          any: [
            { field: 'person.attr.plan', op: 'eq', value: 'pro' },
            { all: [{ field: 'company.attr.tier', op: 'eq', value: 'enterprise' }] },
          ],
        },
      }).success
    ).toBe(true)
  })

  it('rejects an audience leaf with an unknown field, same as any other condition node', () => {
    expect(
      triggerSettingsSchema.safeParse({
        audience: { field: 'conversation.stattus', op: 'eq', value: 'open' },
      }).success
    ).toBe(false)
  })

  it('rejects a non-object audience — the dispatcher guard fails open on this, but authoring still rejects it', () => {
    expect(triggerSettingsSchema.safeParse({ audience: 'garbage' }).success).toBe(false)
    expect(triggerSettingsSchema.safeParse({ audience: 42 }).success).toBe(false)
  })
})

describe('triggerSettingsSchema: sendWindow', () => {
  it('accepts every sendWindow variant and an absent key', () => {
    expect(triggerSettingsSchema.safeParse({}).success).toBe(true)
    for (const sendWindow of ['any', 'inside_office_hours', 'outside_office_hours']) {
      expect(triggerSettingsSchema.safeParse({ sendWindow }).success).toBe(true)
    }
  })

  it('rejects an unrecognized sendWindow value', () => {
    expect(triggerSettingsSchema.safeParse({ sendWindow: 'sometimes' }).success).toBe(false)
  })
})

describe('triggerSettingsSchema: inactivityMinutes (timer-driven unresponsive triggers)', () => {
  it('accepts an absent key and every in-bounds integer', () => {
    expect(triggerSettingsSchema.safeParse({}).success).toBe(true)
    expect(triggerSettingsSchema.safeParse({ inactivityMinutes: 1 }).success).toBe(true)
    expect(triggerSettingsSchema.safeParse({ inactivityMinutes: 60 }).success).toBe(true)
    expect(
      triggerSettingsSchema.safeParse({ inactivityMinutes: MAX_INACTIVITY_MINUTES }).success
    ).toBe(true)
  })

  it('rejects zero, a non-integer, and anything past the 14-day ceiling', () => {
    expect(triggerSettingsSchema.safeParse({ inactivityMinutes: 0 }).success).toBe(false)
    expect(triggerSettingsSchema.safeParse({ inactivityMinutes: 1.5 }).success).toBe(false)
    expect(
      triggerSettingsSchema.safeParse({ inactivityMinutes: MAX_INACTIVITY_MINUTES + 1 }).success
    ).toBe(false)
  })
})

describe('triggerSettingsSchema: breachLeadMinutes (sla.approaching_breach)', () => {
  it('accepts an absent key and every in-bounds integer', () => {
    expect(triggerSettingsSchema.safeParse({}).success).toBe(true)
    expect(triggerSettingsSchema.safeParse({ breachLeadMinutes: 1 }).success).toBe(true)
    expect(triggerSettingsSchema.safeParse({ breachLeadMinutes: 15 }).success).toBe(true)
    expect(
      triggerSettingsSchema.safeParse({ breachLeadMinutes: MAX_BREACH_LEAD_MINUTES }).success
    ).toBe(true)
  })

  it('rejects zero, a non-integer, and anything past the 24-hour ceiling', () => {
    expect(triggerSettingsSchema.safeParse({ breachLeadMinutes: 0 }).success).toBe(false)
    expect(triggerSettingsSchema.safeParse({ breachLeadMinutes: 2.5 }).success).toBe(false)
    expect(
      triggerSettingsSchema.safeParse({ breachLeadMinutes: MAX_BREACH_LEAD_MINUTES + 1 }).success
    ).toBe(false)
  })
})

describe('triggerSettingsSchema: ticketStatusCategory (ticket.status_changed)', () => {
  it('accepts an absent key ("any status change") and each real category', () => {
    expect(triggerSettingsSchema.safeParse({}).success).toBe(true)
    for (const category of ['open', 'pending', 'closed']) {
      expect(triggerSettingsSchema.safeParse({ ticketStatusCategory: category }).success).toBe(true)
    }
  })

  it('rejects an unknown category', () => {
    expect(triggerSettingsSchema.safeParse({ ticketStatusCategory: 'sometimes' }).success).toBe(
      false
    )
  })
})

describe('ticket actions (set_ticket_status / convert_to_ticket)', () => {
  const graphWithAction = (action: unknown) => ({
    nodes: [{ id: 'a', type: 'action', action }],
    edges: [],
  })

  it('accepts set_ticket_status with a non-empty statusId', () => {
    expect(
      workflowGraphSchema.safeParse(
        graphWithAction({ type: 'set_ticket_status', statusId: 'ticket_status_1' })
      ).success
    ).toBe(true)
  })

  it('rejects set_ticket_status with an empty/missing statusId', () => {
    expect(
      workflowGraphSchema.safeParse(graphWithAction({ type: 'set_ticket_status', statusId: '' }))
        .success
    ).toBe(false)
    expect(
      workflowGraphSchema.safeParse(graphWithAction({ type: 'set_ticket_status' })).success
    ).toBe(false)
  })

  it('accepts convert_to_ticket with no settings', () => {
    expect(
      workflowGraphSchema.safeParse(graphWithAction({ type: 'convert_to_ticket' })).success
    ).toBe(true)
  })
})

describe('call_connector node', () => {
  const graphWithConnector = (node: Record<string, unknown>) => ({
    nodes: [
      { id: 't', type: 'trigger' },
      { id: 'cc', ...node },
    ],
    edges: [{ from: 't', to: 'cc' }],
  })

  it('accepts a minimal node (connectorId + empty params, no timeoutMs)', () => {
    expect(
      workflowGraphSchema.safeParse(
        graphWithConnector({ type: 'call_connector', connectorId: 'data_connector_1', params: {} })
      ).success
    ).toBe(true)
  })

  it('accepts params mapping input names to template strings, and an in-bounds timeoutMs', () => {
    expect(
      workflowGraphSchema.safeParse(
        graphWithConnector({
          type: 'call_connector',
          connectorId: 'data_connector_1',
          params: { ticket_id: '{conversation.id}', note: '{first_name|there}' },
          timeoutMs: 5000,
        })
      ).success
    ).toBe(true)
  })

  it('rejects a missing/empty connectorId', () => {
    expect(
      workflowGraphSchema.safeParse(graphWithConnector({ type: 'call_connector', params: {} }))
        .success
    ).toBe(false)
    expect(
      workflowGraphSchema.safeParse(
        graphWithConnector({ type: 'call_connector', connectorId: '', params: {} })
      ).success
    ).toBe(false)
  })

  it('rejects a params value that is not a string', () => {
    expect(
      workflowGraphSchema.safeParse(
        graphWithConnector({
          type: 'call_connector',
          connectorId: 'data_connector_1',
          params: { count: 5 },
        })
      ).success
    ).toBe(false)
  })

  it('accepts timeoutMs exactly at the bounds, rejects one past either bound and a non-integer', () => {
    const withTimeout = (timeoutMs: unknown) =>
      graphWithConnector({
        type: 'call_connector',
        connectorId: 'data_connector_1',
        params: {},
        timeoutMs,
      })
    expect(workflowGraphSchema.safeParse(withTimeout(MIN_CALL_CONNECTOR_TIMEOUT_MS)).success).toBe(
      true
    )
    expect(workflowGraphSchema.safeParse(withTimeout(MAX_CALL_CONNECTOR_TIMEOUT_MS)).success).toBe(
      true
    )
    expect(
      workflowGraphSchema.safeParse(withTimeout(MIN_CALL_CONNECTOR_TIMEOUT_MS - 1)).success
    ).toBe(false)
    expect(
      workflowGraphSchema.safeParse(withTimeout(MAX_CALL_CONNECTOR_TIMEOUT_MS + 1)).success
    ).toBe(false)
    expect(workflowGraphSchema.safeParse(withTimeout(100.5)).success).toBe(false)
  })

  it('accepts a labeled edge with branch "failed", rejects any other branch key', () => {
    const graph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'cc', type: 'call_connector', connectorId: 'data_connector_1', params: {} },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'cc' },
        { from: 'cc', to: 'a', branch: CALL_CONNECTOR_FAILED_KEY },
      ],
    }
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)

    const badBranch = {
      ...graph,
      edges: [
        { from: 't', to: 'cc' },
        { from: 'cc', to: 'a', branch: 'oops' },
      ],
    }
    const result = workflowGraphSchema.safeParse(badBranch)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(undeclaredBranchPathMessage('cc', 'oops'))
    }
  })

  it('accepts an unlabeled (default/success) edge off a call_connector node', () => {
    const graph = {
      nodes: [
        { id: 't', type: 'trigger' },
        { id: 'cc', type: 'call_connector', connectorId: 'data_connector_1', params: {} },
        { id: 'a', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 't', to: 'cc' },
        { from: 'cc', to: 'a' },
      ],
    }
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
  })
})

// Phase C, slice C-6: the class rule for parking blocks.
describe('classRestrictedNodeIssue', () => {
  const parkingNode = { id: 'csat', type: 'request_csat' }
  const sendNode = { id: 'msg', type: 'message' }

  it('is null for a customer_facing workflow regardless of node kinds', () => {
    expect(classRestrictedNodeIssue({ nodes: [parkingNode] }, 'customer_facing')).toBeNull()
  })

  it('is null for a background workflow with no parking-kind node', () => {
    expect(classRestrictedNodeIssue({ nodes: [sendNode] }, 'background')).toBeNull()
  })

  it.each([
    'reply_buttons',
    'collect_data',
    'collect_reply',
    'request_csat',
    'let_assistant_answer',
    'disable_composer',
  ])('flags a %s node in a background workflow, naming the offending step', (type) => {
    const issue = classRestrictedNodeIssue({ nodes: [{ id: 'x', type }] }, 'background')
    expect(issue).not.toBeNull()
    expect(issue).toContain('"x"')
    expect(issue).toContain(type)
  })

  it('names the FIRST offending node when several parking kinds are present', () => {
    const issue = classRestrictedNodeIssue(
      {
        nodes: [
          sendNode,
          { id: 'first-bad', type: 'reply_buttons' },
          { id: 'second-bad', type: 'request_csat' },
        ],
      },
      'background'
    )
    expect(issue).toContain('"first-bad"')
    expect(issue).not.toContain('"second-bad"')
  })

  it('message and show_reply_time stay legal in a background workflow', () => {
    expect(
      classRestrictedNodeIssue(
        { nodes: [sendNode, { id: 'rt', type: 'show_reply_time' }] },
        'background'
      )
    ).toBeNull()
  })
})
