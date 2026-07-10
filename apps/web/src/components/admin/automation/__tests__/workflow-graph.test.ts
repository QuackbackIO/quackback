/**
 * The workflow canvas model: graph <-> tree round-trips (the canvas must be a
 * lossless view over the graph JSON), tree-representability failures, client
 * validation parity with the server schema, and the condition draft mapping.
 */
import { describe, expect, it } from 'vitest'
import {
  workflowGraphSchema,
  MAX_WAIT_SECONDS,
  duplicateStepIdMessage,
  missingStepMessage,
  undeclaredBranchPathMessage,
} from '@/lib/server/domains/workflows/workflow.schemas'
import {
  actionIssue,
  actionSummary,
  attributeFieldForKey,
  collectStepIssues,
  conditionSummary,
  conditionToDraft,
  createStep,
  draftToCondition,
  draftToGraphJson,
  freshStepId,
  graphToTree,
  initialGraphDraft,
  insertStep,
  isConditionField,
  newTree,
  resolveConditionField,
  toAttributeFieldDefs,
  treeToGraph,
  validateGraph,
  type GraphAction,
  type GraphCondition,
  type TreeStep,
  type WorkflowGraphJson,
  type WorkflowTree,
} from '../workflow-graph'

/** A canvas-shaped graph in canonical DFS order: trigger -> condition ->
 *  action -> branch with two labeled paths (one nested wait + action). */
const richGraph: WorkflowGraphJson = {
  nodes: [
    { id: 'trigger', type: 'trigger' },
    {
      id: 'condition-1',
      type: 'condition',
      condition: { all: [{ field: 'conversation.channel', op: 'eq', value: 'email' }] },
    },
    { id: 'action-1', type: 'action', action: { type: 'add_tag', tagId: 'tag_inbound' } },
    {
      id: 'branch-1',
      type: 'branch',
      branches: [
        {
          key: 'VIP',
          condition: { field: 'person.segments', op: 'includes_any', value: ['seg_vip'] },
        },
        { key: 'Everyone else', condition: {} },
      ],
    },
    { id: 'wait-1', type: 'wait', seconds: 3600 },
    { id: 'action-2', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
    { id: 'action-3', type: 'action', action: { type: 'close' } },
  ],
  edges: [
    { from: 'trigger', to: 'condition-1' },
    { from: 'condition-1', to: 'action-1' },
    { from: 'action-1', to: 'branch-1' },
    { from: 'branch-1', to: 'wait-1', branch: 'VIP' },
    { from: 'wait-1', to: 'action-2' },
    { from: 'branch-1', to: 'action-3', branch: 'Everyone else' },
  ],
}

describe('graph <-> tree round-trip', () => {
  it('round-trips a canvas-shaped graph byte-identically', () => {
    const tree = graphToTree(richGraph)
    expect(tree.ok).toBe(true)
    if (!tree.ok) return
    expect(treeToGraph(tree.value)).toEqual(richGraph)
  })

  it('keeps ids and branch keys stable across repeated round-trips', () => {
    const once = graphToTree(richGraph)
    if (!once.ok) throw new Error(once.error)
    const twice = graphToTree(treeToGraph(once.value))
    if (!twice.ok) throw new Error(twice.error)
    expect(treeToGraph(twice.value)).toEqual(richGraph)
  })

  it('serializes an empty tree to a lone trigger node', () => {
    expect(treeToGraph(newTree())).toEqual({
      nodes: [{ id: 'trigger', type: 'trigger' }],
      edges: [],
    })
  })
})

describe('server schema parity', () => {
  it('every canvas-produced graph passes workflowGraphSchema', () => {
    const tree = newTree()
    const steps: TreeStep[] = [
      { id: 'action-1', kind: 'action', action: { type: 'assign_agent', principalId: 'p_1' } },
      { id: 'action-2', kind: 'action', action: { type: 'assign_team', teamId: 't_1' } },
      { id: 'action-3', kind: 'action', action: { type: 'remove_tag', tagId: 'tag_1' } },
      { id: 'action-4', kind: 'action', action: { type: 'snooze', untilIso: null } },
      {
        id: 'action-5',
        kind: 'action',
        action: { type: 'snooze', untilIso: '2026-08-01T09:00:00.000Z' },
      },
      { id: 'action-6', kind: 'action', action: { type: 'apply_sla', policyId: 'sla_1' } },
      { id: 'action-7', kind: 'action', action: { type: 'set_attribute', key: 'plan', value: 5 } },
      { id: 'wait-1', kind: 'wait', seconds: 0 },
      {
        id: 'condition-1',
        kind: 'condition',
        condition: { any: [{ field: 'csat.rating', op: 'lte', value: 2 }] },
      },
      {
        id: 'branch-1',
        kind: 'branch',
        paths: [
          {
            key: 'Office hours',
            condition: { field: 'office_hours', op: 'eq', value: true },
            steps: [
              {
                id: 'action-8',
                kind: 'action',
                action: { type: 'set_priority', priority: 'high' },
              },
            ],
          },
          { key: 'After hours', condition: {}, steps: [] },
        ],
      },
    ]
    const graph = treeToGraph({ ...tree, steps })
    const parsed = workflowGraphSchema.safeParse(graph)
    expect(parsed.success).toBe(true)
    // And the client-side validator agrees.
    expect(validateGraph(graph).ok).toBe(true)
  })

  it('rejects the same incomplete steps the server would, with readable errors', () => {
    const missingAgent = treeToGraph({
      triggerId: 'trigger',
      steps: [
        { id: 'action-1', kind: 'action', action: { type: 'assign_agent', principalId: '' } },
      ],
    })
    expect(workflowGraphSchema.safeParse(missingAgent).success).toBe(false)
    const check = validateGraph(missingAgent)
    expect(check).toEqual({ ok: false, error: 'Step "action-1": choose a teammate to assign' })
  })
})

describe('validateGraph', () => {
  const withNode = (node: unknown): unknown => ({
    nodes: [{ id: 'trigger', type: 'trigger' }, node],
    edges: [],
  })

  it.each([
    ['unknown node type', withNode({ id: 'x', type: 'watt' }), /unknown step type/],
    [
      'unknown condition field',
      withNode({
        id: 'x',
        type: 'condition',
        condition: { field: 'conversation.stattus', op: 'eq' },
      }),
      /unknown condition field/,
    ],
    [
      'unknown operator',
      withNode({
        id: 'x',
        type: 'condition',
        condition: { field: 'conversation.status', op: 'equals' },
      }),
      /unknown operator/,
    ],
    [
      'stray group key',
      withNode({ id: 'x', type: 'condition', condition: { some: [] } }),
      /unexpected key/,
    ],
    ['negative wait', withNode({ id: 'x', type: 'wait', seconds: -5 }), /whole number of seconds/],
    [
      'non-UTC snooze timestamp',
      withNode({
        id: 'x',
        type: 'action',
        action: { type: 'snooze', untilIso: '2026-08-01 09:00' },
      }),
      /UTC timestamp/,
    ],
    ['nodes not an array', { nodes: {}, edges: [] }, /"nodes" must be an array/],
    [
      'edge missing endpoints',
      { nodes: [{ id: 'trigger', type: 'trigger' }], edges: [{ from: 'trigger' }] },
      /"from" and "to"/,
    ],
    [
      'duplicate node id',
      {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'x', type: 'action', action: { type: 'close' } },
          { id: 'x', type: 'action', action: { type: 'close' } },
        ],
        edges: [],
      },
      /Duplicate step id "x"/,
    ],
    [
      'edge references a missing "from" step',
      {
        nodes: [{ id: 'trigger', type: 'trigger' }],
        edges: [{ from: 'ghost', to: 'trigger' }],
      },
      /missing step "ghost"/,
    ],
    [
      'edge references a missing "to" step',
      {
        nodes: [{ id: 'trigger', type: 'trigger' }],
        edges: [{ from: 'trigger', to: 'ghost' }],
      },
      /missing step "ghost"/,
    ],
    [
      'undeclared branch path key',
      {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'branch-1', type: 'branch', branches: [{ key: 'A', condition: {} }] },
          { id: 'x', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 'trigger', to: 'branch-1' },
          { from: 'branch-1', to: 'x', branch: 'B' },
        ],
      },
      /undeclared path "B"/,
    ],
    [
      'wait past MAX_WAIT_SECONDS',
      withNode({ id: 'x', type: 'wait', seconds: MAX_WAIT_SECONDS + 1 }),
      /at most 90 days/,
    ],
  ])('rejects %s', (_name, graph, message) => {
    const result = validateGraph(graph)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })

  // The four structural rules above are hand-copied at two call sites
  // (validateGraph here, workflowGraphSchema's superRefine server-side) and
  // had already drifted (capitalization, prefix) before both were switched to
  // build their message text from the same exported functions. These pin the
  // exact composed string (client index prefix + shared builder output) so a
  // future edit to one side can't silently drift from the other again.
  describe('structural-validation messages match the server-shared builders', () => {
    it('duplicate step id', () => {
      const dup = {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'x', type: 'action', action: { type: 'close' } },
          { id: 'x', type: 'action', action: { type: 'close' } },
        ],
        edges: [],
      }
      const result = validateGraph(dup)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe(duplicateStepIdMessage('x'))
    })

    it('edge referencing a missing "from"/"to" step, prefixed with its edge index', () => {
      const missingFrom = {
        nodes: [{ id: 'trigger', type: 'trigger' }],
        edges: [{ from: 'ghost', to: 'trigger' }],
      }
      const fromResult = validateGraph(missingFrom)
      expect(fromResult.ok).toBe(false)
      if (!fromResult.ok) expect(fromResult.error).toBe(`edges[0]: ${missingStepMessage('ghost')}`)

      const missingTo = {
        nodes: [{ id: 'trigger', type: 'trigger' }],
        edges: [{ from: 'trigger', to: 'ghost' }],
      }
      const toResult = validateGraph(missingTo)
      expect(toResult.ok).toBe(false)
      if (!toResult.ok) expect(toResult.error).toBe(`edges[0]: ${missingStepMessage('ghost')}`)
    })

    it('undeclared branch path key, prefixed with its edge index', () => {
      const undeclaredKey = {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'branch-1', type: 'branch', branches: [{ key: 'A', condition: {} }] },
          { id: 'x', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 'trigger', to: 'branch-1' },
          { from: 'branch-1', to: 'x', branch: 'B' },
        ],
      }
      const result = validateGraph(undeclaredKey)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe(`edges[1]: ${undeclaredBranchPathMessage('branch-1', 'B')}`)
      }
    })
  })

  it('accepts a wait exactly at MAX_WAIT_SECONDS', () => {
    expect(validateGraph(withNode({ id: 'x', type: 'wait', seconds: MAX_WAIT_SECONDS })).ok).toBe(
      true
    )
  })
})

describe('graphToTree representability', () => {
  const trigger = { id: 'trigger', type: 'trigger' } as const
  const action = (id: string) =>
    ({ id, type: 'action', action: { type: 'close' } }) as WorkflowGraphJson['nodes'][number]

  it.each([
    [
      'two triggers',
      { nodes: [trigger, { id: 't2', type: 'trigger' }], edges: [] },
      /more than one trigger/,
    ],
    ['no trigger', { nodes: [action('a')], edges: [] }, /no trigger/],
    [
      'unreachable step',
      { nodes: [trigger, action('a')], edges: [] },
      /needs exactly one incoming connection/,
    ],
    [
      'merge (two parents)',
      {
        nodes: [trigger, action('a'), action('b'), action('c')],
        edges: [
          { from: 'trigger', to: 'a' },
          { from: 'a', to: 'c' },
          { from: 'b', to: 'c' },
        ],
      },
      /incoming connection/,
    ],
    [
      'labeled edge from a non-branch step',
      {
        nodes: [trigger, action('a'), action('b')],
        edges: [
          { from: 'trigger', to: 'a' },
          { from: 'a', to: 'b', branch: 'oops' },
        ],
      },
      /labeled connection but is not a branch/,
    ],
    [
      'duplicate node ids',
      { nodes: [trigger, action('a'), action('a')], edges: [{ from: 'trigger', to: 'a' }] },
      /share the id/,
    ],
  ])('falls back to JSON for %s', (_name, graph, message) => {
    const result = graphToTree(graph as WorkflowGraphJson)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })

  it('initialGraphDraft opens those graphs in JSON mode with a notice', () => {
    const graph = { nodes: [trigger, action('a')], edges: [] }
    const draft = initialGraphDraft(graph)
    expect(draft.mode).toBe('json')
    if (draft.mode === 'json') {
      expect(draft.notice).toMatch(/Shown as JSON/)
      expect(JSON.parse(draft.text)).toEqual(graph)
    }
  })

  it('initialGraphDraft opens tree-shaped and missing graphs on the canvas', () => {
    expect(initialGraphDraft(undefined)).toEqual({ mode: 'visual', tree: newTree() })
    const draft = initialGraphDraft(richGraph)
    expect(draft.mode).toBe('visual')
  })
})

describe('condition drafts', () => {
  it('maps a leaf to one rule and back to a leaf', () => {
    const leaf = { field: 'message.body', op: 'contains', value: 'refund' } as const
    const draft = conditionToDraft(leaf)
    expect(draft).toEqual({
      kind: 'simple',
      mode: 'all',
      rules: [{ field: 'message.body', op: 'contains', value: 'refund' }],
    })
    if (draft.kind === 'simple') expect(draftToCondition(draft)).toEqual(leaf)
  })

  it('round-trips any-groups and typed values (number, boolean, list)', () => {
    const group: GraphCondition = {
      any: [
        { field: 'csat.rating', op: 'lte', value: 2 },
        { field: 'office_hours', op: 'eq', value: false },
        { field: 'conversation.tags', op: 'includes_any', value: ['tag_a', 'tag_b'] },
      ],
    }
    const draft = conditionToDraft(group)
    expect(draft.kind).toBe('simple')
    if (draft.kind !== 'simple') return
    expect(draft.mode).toBe('any')
    expect(draft.rules[0]?.value).toBe('2')
    expect(draft.rules[1]?.value).toBe('false')
    expect(draft.rules[2]?.value).toBe('tag_a, tag_b')
    expect(draftToCondition(draft)).toEqual(group)
  })

  it('treats an empty group as "matches everything"', () => {
    const draft = conditionToDraft({})
    expect(draft).toEqual({ kind: 'simple', mode: 'all', rules: [] })
    if (draft.kind === 'simple') expect(draftToCondition(draft)).toEqual({})
  })

  it('preserves nested groups untouched as advanced', () => {
    const nested: GraphCondition = {
      all: [{ any: [{ field: 'conversation.status', op: 'eq', value: 'open' }] }],
    }
    const draft = conditionToDraft(nested)
    expect(draft).toEqual({ kind: 'advanced', condition: nested })
  })
})

describe('tree editing helpers', () => {
  it('inserting a branch mid-path moves the tail into its first path', () => {
    const tree: WorkflowTree = {
      triggerId: 'trigger',
      steps: [
        { id: 'action-1', kind: 'action', action: { type: 'close' } },
        { id: 'wait-1', kind: 'wait', seconds: 60 },
      ],
    }
    const branch = createStep(tree, 'branch')
    const steps = insertStep(tree.steps, 1, branch)
    expect(steps.map((s) => s.kind)).toEqual(['action', 'branch'])
    const inserted = steps[1]
    if (inserted?.kind !== 'branch') throw new Error('expected a branch')
    expect(inserted.paths[0]?.steps.map((s) => s.id)).toEqual(['wait-1'])
    // The invariant holds, so the serialized graph is still tree-shaped.
    const graph = treeToGraph({ ...tree, steps })
    expect(graphToTree(graph).ok).toBe(true)
  })

  it('freshStepId skips ids already used anywhere in the tree', () => {
    const tree: WorkflowTree = {
      triggerId: 'trigger',
      steps: [
        {
          id: 'branch-1',
          kind: 'branch',
          paths: [
            {
              key: 'A',
              condition: {},
              steps: [{ id: 'action-1', kind: 'action', action: { type: 'close' } }],
            },
          ],
        },
      ],
    }
    expect(freshStepId(tree, 'action')).toBe('action-2')
    expect(freshStepId(tree, 'branch')).toBe('branch-2')
    expect(freshStepId(tree, 'wait')).toBe('wait-1')
  })

  it('draftToGraphJson validates the JSON escape hatch', () => {
    const bad = draftToGraphJson({ mode: 'json', text: '{ nope' })
    expect(bad.ok).toBe(false)
    const good = draftToGraphJson({ mode: 'json', text: JSON.stringify(richGraph) })
    expect(good).toEqual({ ok: true, value: richGraph })
  })
})

// ---------------------------------------------------------------------------
// Attribute conditions (AI attributes parity Phase 0): `conversation.attr.*`
// authoring. The engine already evaluates this prefix
// (condition.evaluator.ts); this suite covers the client unlocking it.
// ---------------------------------------------------------------------------

describe('attribute condition fields', () => {
  const attributeDefs = toAttributeFieldDefs([
    {
      key: 'plan',
      label: 'Plan',
      fieldType: 'select',
      options: [
        { id: 'opt_free', label: 'Free' },
        { id: 'opt_pro', label: 'Pro' },
      ],
    },
    {
      key: 'topics',
      label: 'Topics',
      fieldType: 'multi_select',
      options: [
        { id: 'opt_billing', label: 'Billing' },
        { id: 'opt_bug', label: 'Bug' },
      ],
    },
    { key: 'is_escalated', label: 'Escalated', fieldType: 'checkbox' },
    { key: 'seats', label: 'Seats', fieldType: 'number' },
    { key: 'summary', label: 'Summary', fieldType: 'text' },
    { key: 'renewal', label: 'Renewal date', fieldType: 'date' },
  ])

  describe('isConditionField / validateGraph', () => {
    it('accepts the conversation.attr. prefix for any non-empty key', () => {
      expect(isConditionField('conversation.attr.plan')).toBe(true)
      expect(isConditionField('conversation.attr.some_unregistered_key')).toBe(true)
    })

    it('rejects an empty attribute key and unrelated prefixes', () => {
      expect(isConditionField('conversation.attr.')).toBe(false)
      expect(isConditionField('conversation.attrs.plan')).toBe(false)
      expect(isConditionField('conversation.stattus')).toBe(false)
    })

    it('accepts an attribute condition in visual (leaf) shape', () => {
      const graph = {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'x',
            type: 'condition',
            condition: { field: 'conversation.attr.plan', op: 'eq', value: 'opt_pro' },
          },
        ],
        edges: [{ from: 'trigger', to: 'x' }],
      }
      expect(validateGraph(graph).ok).toBe(true)
    })

    it('accepts an unknown/archived attribute key (degrades, does not block)', () => {
      const graph = {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'x',
            type: 'condition',
            condition: { field: 'conversation.attr.retired_key', op: 'is_set' },
          },
        ],
        edges: [{ from: 'trigger', to: 'x' }],
      }
      expect(validateGraph(graph).ok).toBe(true)
    })

    it('still rejects a garbage field with the same JSON shape', () => {
      const graph = {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'x', type: 'condition', condition: { field: 'conversation.attr.', op: 'eq' } },
        ],
        edges: [{ from: 'trigger', to: 'x' }],
      }
      const result = validateGraph(graph)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/unknown condition field/)
    })
  })

  describe('operator filtering per attribute field type', () => {
    it.each([
      ['select', 'plan', ['eq', 'neq', 'is_set', 'is_empty']],
      ['multi_select', 'topics', ['includes_any', 'excludes_all', 'is_set', 'is_empty']],
      ['checkbox', 'is_escalated', ['eq']],
      ['number', 'seats', ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_set', 'is_empty']],
      ['text', 'summary', ['contains', 'not_contains', 'eq', 'neq', 'is_set', 'is_empty']],
      ['date', 'renewal', ['is_set', 'is_empty']],
    ] as const)('%s attributes offer exactly %j', (_type, key, expected) => {
      const resolved = resolveConditionField(attributeFieldForKey(key), attributeDefs)
      expect([...resolved.operators]).toEqual([...expected])
    })

    it('falls back to every operator for an unresolved attribute key', () => {
      const resolved = resolveConditionField(attributeFieldForKey('nope'), attributeDefs)
      expect(resolved.unresolved).toBe(true)
      expect(resolved.operators.length).toBeGreaterThan(6)
    })
  })

  describe('draft <-> condition round-trip', () => {
    it('round-trips a select eq condition, storing the option id', () => {
      const leaf: GraphCondition = {
        field: 'conversation.attr.plan',
        op: 'eq',
        value: 'opt_pro',
      }
      const draft = conditionToDraft(leaf)
      expect(draft).toEqual({
        kind: 'simple',
        mode: 'all',
        rules: [{ field: 'conversation.attr.plan', op: 'eq', value: 'opt_pro' }],
      })
      if (draft.kind === 'simple') expect(draftToCondition(draft, attributeDefs)).toEqual(leaf)
    })

    it('round-trips a multi_select includes_any condition as a string[]', () => {
      const leaf: GraphCondition = {
        field: 'conversation.attr.topics',
        op: 'includes_any',
        value: ['opt_billing', 'opt_bug'],
      }
      const draft = conditionToDraft(leaf)
      if (draft.kind !== 'simple') throw new Error('expected simple draft')
      expect(draft.rules[0]?.value).toBe('opt_billing, opt_bug')
      expect(draftToCondition(draft, attributeDefs)).toEqual(leaf)
    })

    it('round-trips a checkbox eq condition as a real boolean, not the string "true"', () => {
      const leaf: GraphCondition = {
        field: 'conversation.attr.is_escalated',
        op: 'eq',
        value: true,
      }
      const draft = conditionToDraft(leaf)
      if (draft.kind !== 'simple') throw new Error('expected simple draft')
      expect(draft.rules[0]?.value).toBe('true')
      const rebuilt = draftToCondition(draft, attributeDefs)
      expect(rebuilt).toEqual(leaf)
      if ('field' in rebuilt) expect(typeof rebuilt.value).toBe('boolean')
    })

    it('round-trips a number condition', () => {
      const leaf: GraphCondition = { field: 'conversation.attr.seats', op: 'gte', value: 5 }
      const draft = conditionToDraft(leaf)
      if (draft.kind !== 'simple') throw new Error('expected simple draft')
      expect(draftToCondition(draft, attributeDefs)).toEqual(leaf)
    })

    it('is_set/is_empty carry no value either direction', () => {
      const leaf: GraphCondition = { field: 'conversation.attr.plan', op: 'is_set' }
      const draft = conditionToDraft(leaf)
      if (draft.kind !== 'simple') throw new Error('expected simple draft')
      expect(draft.rules[0]?.value).toBe('')
      expect(draftToCondition(draft, attributeDefs)).toEqual(leaf)
    })
  })

  describe('conditionSummary label resolution', () => {
    it('renders the definition label and option label, not the raw key/id', () => {
      const condition: GraphCondition = {
        field: 'conversation.attr.plan',
        op: 'eq',
        value: 'opt_pro',
      }
      expect(conditionSummary(condition, attributeDefs)).toBe('Plan is Pro')
    })

    it('renders option labels for a multi_select value', () => {
      const condition: GraphCondition = {
        field: 'conversation.attr.topics',
        op: 'includes_any',
        value: ['opt_billing', 'opt_bug'],
      }
      expect(conditionSummary(condition, attributeDefs)).toBe('Topics includes any of Billing, Bug')
    })

    it('renders yes/no for a checkbox value', () => {
      const condition: GraphCondition = {
        field: 'conversation.attr.is_escalated',
        op: 'eq',
        value: true,
      }
      expect(conditionSummary(condition, attributeDefs)).toBe('Escalated is yes')
    })

    it('falls back to the raw key when the definition is missing', () => {
      const condition: GraphCondition = {
        field: 'conversation.attr.retired_key',
        op: 'is_set',
      }
      expect(conditionSummary(condition, attributeDefs)).toBe(
        'Unknown attribute retired_key is set'
      )
    })

    it('falls back to the raw key with no attributes map supplied at all', () => {
      const condition: GraphCondition = { field: 'conversation.attr.plan', op: 'is_set' }
      expect(conditionSummary(condition)).toBe('Unknown attribute plan is set')
    })
  })

  describe('conversation.team — dynamic team options', () => {
    const teamLabels = new Map([
      ['team_support', 'Support'],
      ['team_billing', 'Billing'],
    ])

    it('resolveConditionField fills options in from the live team map', () => {
      const resolved = resolveConditionField('conversation.team', undefined, teamLabels)
      expect(resolved.kind).toBe('choice')
      expect(resolved.operators).toEqual(['eq', 'neq', 'is_set', 'is_empty'])
      expect(resolved.options).toEqual([
        { value: 'team_support', label: 'Support' },
        { value: 'team_billing', label: 'Billing' },
      ])
    })

    it('has no static options when no team map is supplied', () => {
      const resolved = resolveConditionField('conversation.team')
      expect(resolved.options).toEqual([])
    })

    it('conditionSummary renders the team name, not the raw id', () => {
      const condition: GraphCondition = {
        field: 'conversation.team',
        op: 'eq',
        value: 'team_support',
      }
      expect(conditionSummary(condition, undefined, teamLabels)).toBe('Team is Support')
    })

    it('conditionSummary falls back to the raw id for an unknown team', () => {
      const condition: GraphCondition = { field: 'conversation.team', op: 'eq', value: 'team_gone' }
      expect(conditionSummary(condition, undefined, teamLabels)).toBe('Team is team_gone')
    })

    it('conditionSummary renders is_empty with no value ("no team assigned")', () => {
      const condition: GraphCondition = { field: 'conversation.team', op: 'is_empty' }
      expect(conditionSummary(condition, undefined, teamLabels)).toBe('Team is empty')
    })

    it('round-trips through the draft encoding as a plain string id', () => {
      const leaf: GraphCondition = { field: 'conversation.team', op: 'eq', value: 'team_support' }
      const draft = conditionToDraft(leaf)
      if (draft.kind !== 'simple') throw new Error('expected simple draft')
      expect(draft.rules[0]).toEqual({
        field: 'conversation.team',
        op: 'eq',
        value: 'team_support',
      })
      expect(draftToCondition(draft)).toEqual(leaf)
    })
  })
})

describe('snooze action: relative duration', () => {
  it('round-trips a relative snooze through the tree <-> graph conversion', () => {
    const tree: WorkflowTree = {
      triggerId: 'trigger',
      steps: [{ id: 'a1', kind: 'action', action: { type: 'snooze', seconds: 7200 } }],
    }
    const graph = treeToGraph(tree)
    expect(graph.nodes).toContainEqual({
      id: 'a1',
      type: 'action',
      action: { type: 'snooze', seconds: 7200 },
    })
    const back = graphToTree(graph)
    expect(back).toEqual({ ok: true, value: tree })
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
  })

  it('still round-trips a legacy absolute/until-reply snooze', () => {
    const tree: WorkflowTree = {
      triggerId: 'trigger',
      steps: [
        { id: 'a1', kind: 'action', action: { type: 'snooze', untilIso: null } },
        {
          id: 'a2',
          kind: 'action',
          action: { type: 'snooze', untilIso: '2026-08-01T09:00:00.000Z' },
        },
      ],
    }
    const graph = treeToGraph(tree)
    const back = graphToTree(graph)
    expect(back).toEqual({ ok: true, value: tree })
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
  })

  it('validateAction (client) accepts a relative snooze within bounds, rejects a negative one', () => {
    const graphOk = {
      nodes: [{ id: 'a', type: 'action', action: { type: 'snooze', seconds: 60 } }],
      edges: [],
    }
    expect(validateGraph(graphOk).ok).toBe(true)

    const graphBad = {
      nodes: [{ id: 'a', type: 'action', action: { type: 'snooze', seconds: -1 } }],
      edges: [],
    }
    const result = validateGraph(graphBad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/whole number of seconds/)
  })

  it('summarizes a relative snooze, and still summarizes a legacy absolute one', () => {
    expect(actionSummary({ type: 'snooze', seconds: 3600 })).toBe('Snooze for 1 hour')
    expect(actionSummary({ type: 'snooze', seconds: 7200 })).toBe('Snooze for 2 hours')
    expect(actionSummary({ type: 'snooze', untilIso: null })).toBe('Snooze until they reply')
    expect(actionSummary({ type: 'snooze', untilIso: '2026-08-01T09:00:00.000Z' })).toMatch(
      /^Snooze until /
    )
  })

  it('flags a zero-duration relative snooze as an issue; a legacy value never is', () => {
    expect(actionIssue({ type: 'snooze', seconds: 0 })).toBe('Choose how long to snooze for')
    expect(actionIssue({ type: 'snooze', seconds: 60 })).toBeNull()
    expect(actionIssue({ type: 'snooze', untilIso: null })).toBeNull()
    expect(actionIssue({ type: 'snooze', untilIso: '2026-08-01T09:00:00.000Z' })).toBeNull()
  })

  it('surfaces the zero-duration issue through collectStepIssues, same as any other action', () => {
    const tree: WorkflowTree = {
      triggerId: 'trigger',
      steps: [{ id: 'a1', kind: 'action', action: { type: 'snooze', seconds: 0 } }],
    }
    const issues = collectStepIssues(tree)
    expect(issues.get('a1')).toBe('Choose how long to snooze for')
  })

  it('accepts a relative snooze exactly at MAX_WAIT_SECONDS in the server schema', () => {
    const action: GraphAction = { type: 'snooze', seconds: MAX_WAIT_SECONDS }
    expect(
      workflowGraphSchema.safeParse({
        nodes: [{ id: 'a', type: 'action', action }],
        edges: [],
      }).success
    ).toBe(true)
  })
})
