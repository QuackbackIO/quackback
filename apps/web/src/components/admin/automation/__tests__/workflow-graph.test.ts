/**
 * The workflow canvas model: graph <-> tree round-trips (the canvas must be a
 * lossless view over the graph JSON), tree-representability failures, client
 * validation parity with the server schema, and the condition draft mapping.
 */
import { describe, expect, it } from 'vitest'
import {
  workflowGraphSchema,
  MAX_WAIT_SECONDS,
  BLOCK_NODE_TYPES,
  duplicateStepIdMessage,
  missingStepMessage,
  undeclaredBranchPathMessage,
} from '@/lib/server/domains/workflows/workflow.schemas'
import {
  actionIssue,
  actionSummary,
  attributeFieldForKey,
  audienceUnreachableFieldWarning,
  BLOCK_STEP_LABELS,
  callConnectorSummary,
  CALL_CONNECTOR_FAILED_KEY,
  CALL_CONNECTOR_SUCCESS_KEY,
  MIN_CALL_CONNECTOR_TIMEOUT_MS,
  MAX_CALL_CONNECTOR_TIMEOUT_MS,
  collectStepIssues,
  conditionSummary,
  conditionToDraft,
  conditionToGroupDraft,
  groupsToCondition,
  defaultRuleGroup,
  createStep,
  defaultAction,
  deriveOutline,
  draftIssues,
  draftToCondition,
  draftToGraphJson,
  EMPTY_BLOCK_BODY,
  freshStepId,
  graphToTree,
  initialGraphDraft,
  insertStep,
  insertVariableToken,
  isConditionField,
  isPersonAttributeField,
  isCompanyAttributeField,
  isNeedsSetupRef,
  NEEDS_SETUP_PREFIX,
  personAttributeFieldForKey,
  companyAttributeFieldForKey,
  toPersonCompanyAttributeFieldDefs,
  LET_ASSISTANT_DEFAULT_KEY,
  LET_ASSISTANT_ESCALATED_KEY,
  newTree,
  RATING_LABELS,
  resolveConditionField,
  toAttributeFieldDefs,
  treeToGraph,
  TRIGGER_LABELS,
  TRIGGER_TYPES,
  validateGraph,
  type ConnectorMeta,
  type GraphAction,
  type GraphCondition,
  type RuleGroupDraft,
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

  // Drift guardrail (Phase C, slice C-5): the client's hand-authored
  // BLOCK_STEP_LABELS catalogue must cover exactly the server's block node
  // kinds — nothing else fails the typecheck or a test when a kind is added
  // on one side and forgotten on the other.
  it('BLOCK_STEP_LABELS covers exactly the server node-kind union of block kinds', () => {
    expect(new Set(Object.keys(BLOCK_STEP_LABELS))).toEqual(new Set(BLOCK_NODE_TYPES))
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

describe('condition GROUP drafts (RuleGroupBuilder — 2-level OR-of-groups)', () => {
  it('a flat leaf/simple condition decodes as one implicit group, matching conditionToDraft', () => {
    const leaf: GraphCondition = { field: 'conversation.status', op: 'eq', value: 'open' }
    expect(conditionToGroupDraft(leaf)).toEqual({
      kind: 'groups',
      groups: [{ mode: 'all', rules: [{ field: 'conversation.status', op: 'eq', value: 'open' }] }],
    })
    expect(conditionToGroupDraft({})).toEqual({
      kind: 'groups',
      groups: [{ mode: 'all', rules: [] }],
    })
  })

  it('round-trips a 2-group OR shape — the exact `any: [{all:[...]}, {any:[...]}]` stored shape', () => {
    const nested: GraphCondition = {
      any: [
        {
          all: [
            { field: 'person.attr.plan', op: 'eq', value: 'pro' },
            { field: 'conversation.priority', op: 'eq', value: 'high' },
          ],
        },
        { any: [{ field: 'company.attr.tier', op: 'eq', value: 'enterprise' }] },
      ],
    }
    const draft = conditionToGroupDraft(nested)
    expect(draft).toEqual({
      kind: 'groups',
      groups: [
        {
          mode: 'all',
          rules: [
            { field: 'person.attr.plan', op: 'eq', value: 'pro' },
            { field: 'conversation.priority', op: 'eq', value: 'high' },
          ],
        },
        { mode: 'any', rules: [{ field: 'company.attr.tier', op: 'eq', value: 'enterprise' }] },
      ],
    })
    if (draft.kind !== 'groups') return
    expect(groupsToCondition(draft.groups)).toEqual(nested)
  })

  it('a single group ALWAYS collapses to the flat shape on write, even inside an explicit any-wrap on read', () => {
    // { any: [ {all: [leaf]} ] } is a single group in an explicit wrap — it
    // still reads back as ONE group (no OR-of-groups UI shown), and writing
    // that one group back collapses through draftToCondition, same as the
    // plain flat editor's own single-rule collapse.
    const stored: GraphCondition = {
      any: [{ all: [{ field: 'conversation.status', op: 'eq', value: 'open' }] }],
    }
    const draft = conditionToGroupDraft(stored)
    expect(draft.kind).toBe('groups')
    if (draft.kind !== 'groups') return
    expect(draft.groups).toHaveLength(1)
    expect(groupsToCondition(draft.groups)).toEqual({
      field: 'conversation.status',
      op: 'eq',
      value: 'open',
    })
  })

  it('a mixed top-level any (bare leaf alongside a group) is advanced — ambiguous, not a clean OR-of-groups', () => {
    const mixed: GraphCondition = {
      any: [
        { field: 'conversation.status', op: 'eq', value: 'open' },
        { all: [{ field: 'conversation.priority', op: 'eq', value: 'high' }] },
      ],
    }
    expect(conditionToGroupDraft(mixed)).toEqual({ kind: 'advanced', condition: mixed })
  })

  it('a top-level AND of groups is advanced — only OR-of-groups is representable', () => {
    const andOfGroups: GraphCondition = {
      all: [
        { any: [{ field: 'conversation.status', op: 'eq', value: 'open' }] },
        { any: [{ field: 'conversation.priority', op: 'eq', value: 'high' }] },
      ],
    }
    expect(conditionToGroupDraft(andOfGroups)).toEqual({ kind: 'advanced', condition: andOfGroups })
  })

  it('a group nesting a group (3 levels deep) is advanced', () => {
    const tripleNested: GraphCondition = {
      any: [{ all: [{ any: [{ field: 'conversation.status', op: 'eq', value: 'open' }] }] }],
    }
    expect(conditionToGroupDraft(tripleNested)).toEqual({
      kind: 'advanced',
      condition: tripleNested,
    })
  })

  it('groupsToCondition of zero groups is the empty (matches-everything) condition', () => {
    expect(groupsToCondition([])).toEqual({})
  })

  it('an emptied group inside a multi-group OR is dropped, not encoded as a vacuously-true {all: []}', () => {
    // Regression: {all: []} / {any: []} both evaluate to true in
    // evaluateCondition (condition.evaluator.ts), so wrapping an emptied
    // group verbatim inside the top-level `any` would make the WHOLE OR
    // match everything the instant one group is emptied out — silently
    // overriding the other group's real rule.
    const groups: RuleGroupDraft[] = [
      { mode: 'all', rules: [] },
      { mode: 'all', rules: [{ field: 'conversation.priority', op: 'eq', value: 'high' }] },
    ]
    expect(groupsToCondition(groups)).toEqual({
      field: 'conversation.priority',
      op: 'eq',
      value: 'high',
    })
  })

  it('an emptied group among 3+ groups drops only the empty one and still wraps the survivors', () => {
    const groups: RuleGroupDraft[] = [
      { mode: 'all', rules: [] },
      { mode: 'all', rules: [{ field: 'conversation.priority', op: 'eq', value: 'high' }] },
      { mode: 'any', rules: [{ field: 'conversation.status', op: 'eq', value: 'open' }] },
    ]
    expect(groupsToCondition(groups)).toEqual({
      any: [
        { all: [{ field: 'conversation.priority', op: 'eq', value: 'high' }] },
        { any: [{ field: 'conversation.status', op: 'eq', value: 'open' }] },
      ],
    })
  })

  it('all groups emptied in a multi-group OR collapses to {} — same as zero groups', () => {
    const groups: RuleGroupDraft[] = [
      { mode: 'all', rules: [] },
      { mode: 'any', rules: [] },
    ]
    expect(groupsToCondition(groups)).toEqual({})
  })

  it('decoding a legacy stored condition with an already-emptied group still renders as groups (not advanced)', () => {
    const legacyEmptyGroup: GraphCondition = {
      any: [{ all: [] }, { all: [{ field: 'conversation.status', op: 'eq', value: 'open' }] }],
    }
    const draft = conditionToGroupDraft(legacyEmptyGroup)
    expect(draft.kind).toBe('groups')
    if (draft.kind !== 'groups') return
    expect(draft.groups).toHaveLength(2)
    expect(draft.groups[0]!.rules).toEqual([])
    // Re-encoding (even a no-op save) drops the emptied group instead of
    // reproducing the vacuously-true {all: []} that let it override the
    // real group.
    expect(groupsToCondition(draft.groups)).toEqual({
      field: 'conversation.status',
      op: 'eq',
      value: 'open',
    })
  })

  it('defaultRuleGroup seeds one rule in "all" mode, for "Add group"', () => {
    expect(defaultRuleGroup()).toEqual({
      mode: 'all',
      rules: [{ field: 'conversation.status', op: 'eq', value: 'open' }],
    })
  })

  it('conditionSummary describes a 2-group OR as "Any of 2 groups matched" instead of bailing', () => {
    const nested: GraphCondition = {
      any: [
        { all: [{ field: 'conversation.priority', op: 'eq', value: 'high' }] },
        { all: [{ field: 'conversation.status', op: 'eq', value: 'open' }] },
      ],
    }
    expect(conditionSummary(nested)).toBe('Any of 2 groups matched')
  })

  it('conditionSummary still bails to "Custom condition" for a group nesting a group', () => {
    const tripleNested: GraphCondition = {
      any: [{ all: [{ any: [{ field: 'conversation.status', op: 'eq', value: 'open' }] }] }],
    }
    expect(conditionSummary(tripleNested)).toBe('Custom condition')
  })

  it('draft <-> graph losslessness regression: a condition step carrying a 2-group nested shape — previously JSON-only, now visually rendered — still round-trips byte-identically through graphToTree <-> treeToGraph', () => {
    const nestedAudienceLikeCondition: GraphCondition = {
      any: [
        {
          all: [
            { field: 'person.attr.plan', op: 'eq', value: 'pro' },
            { field: 'conversation.priority', op: 'eq', value: 'high' },
          ],
        },
        { any: [{ field: 'company.attr.tier', op: 'eq', value: 'enterprise' }] },
      ],
    }
    const graph: WorkflowGraphJson = {
      nodes: [
        { id: 'trigger', type: 'trigger' },
        { id: 'condition-1', type: 'condition', condition: nestedAudienceLikeCondition },
      ],
      edges: [{ from: 'trigger', to: 'condition-1' }],
    }

    // graphToTree/treeToGraph carry the condition value opaquely (they never
    // inspect its internals) — this was always true, and stays true: the
    // ONLY thing that changed is RuleGroupBuilder can now render this shape
    // instead of degrading it to JSON-only in the inspector.
    const tree = graphToTree(graph)
    expect(tree.ok).toBe(true)
    if (!tree.ok) return
    const conditionStep = tree.value.steps[0]
    expect(conditionStep).toMatchObject({
      kind: 'condition',
      condition: nestedAudienceLikeCondition,
    })

    const rebuilt = treeToGraph(tree.value)
    expect(rebuilt).toEqual(graph)

    // AND the visual editor can now actually render (not just carry) it:
    // this exact shape decodes to two OR'd groups instead of bailing to
    // "advanced".
    const draft = conditionToGroupDraft(nestedAudienceLikeCondition)
    expect(draft.kind).toBe('groups')
    if (draft.kind !== 'groups') return
    expect(draft.groups).toHaveLength(2)
    // Editing it back (even a no-op re-encode) preserves the OR-of-groups
    // shape server validation (workflowGraphSchema) already accepts.
    expect(groupsToCondition(draft.groups)).toEqual(nestedAudienceLikeCondition)
    expect(
      workflowGraphSchema.safeParse({
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === 'condition-1' ? { ...n, condition: groupsToCondition(draft.groups) } : n
        ),
      }).success
    ).toBe(true)
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

// ---------------------------------------------------------------------------
// person.attr.<key> / company.attr.<key> + person.email: mirrors the
// "attribute condition fields" suite above, but against the simpler
// person/company attribute registry (no select/multi_select, so no
// `options`) and one static field.
// ---------------------------------------------------------------------------

describe('person/company attribute condition fields', () => {
  const personAttributeDefs = toPersonCompanyAttributeFieldDefs([
    { key: 'plan', label: 'Plan', type: 'string' },
    { key: 'seats', label: 'Seats', type: 'number' },
    { key: 'is_champion', label: 'Champion', type: 'boolean' },
    { key: 'renewal', label: 'Renewal date', type: 'date' },
  ])
  const companyAttributeDefs = toPersonCompanyAttributeFieldDefs([
    { key: 'tier', label: 'Tier', type: 'string' },
    { key: 'arr', label: 'ARR', type: 'currency' },
  ])

  describe('isConditionField / isPersonAttributeField / isCompanyAttributeField', () => {
    it('accepts person.attr. and company.attr. prefixes for any non-empty key', () => {
      expect(isConditionField('person.attr.plan')).toBe(true)
      expect(isConditionField('company.attr.tier')).toBe(true)
      expect(isPersonAttributeField('person.attr.plan')).toBe(true)
      expect(isCompanyAttributeField('company.attr.tier')).toBe(true)
    })

    it('rejects an empty key and unrelated lookalike prefixes', () => {
      expect(isConditionField('person.attr.')).toBe(false)
      expect(isConditionField('company.attr.')).toBe(false)
      expect(isConditionField('person.attrs.plan')).toBe(false)
      expect(isPersonAttributeField('company.attr.tier')).toBe(false)
      expect(isCompanyAttributeField('person.attr.plan')).toBe(false)
    })

    it('accepts person.email as a static field', () => {
      expect(isConditionField('person.email')).toBe(true)
    })
  })

  describe('operator filtering per person/company attribute type', () => {
    it.each([
      ['string', 'plan', ['contains', 'not_contains', 'eq', 'neq', 'is_set', 'is_empty']],
      ['number', 'seats', ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_set', 'is_empty']],
      ['boolean', 'is_champion', ['eq']],
      ['date', 'renewal', ['is_set', 'is_empty']],
    ] as const)('person.attr %s offers exactly %j', (_type, key, expected) => {
      const resolved = resolveConditionField(
        personAttributeFieldForKey(key),
        undefined,
        undefined,
        personAttributeDefs
      )
      expect([...resolved.operators]).toEqual([...expected])
    })

    it('company.attr currency compares numerically, like number', () => {
      const resolved = resolveConditionField(
        companyAttributeFieldForKey('arr'),
        undefined,
        undefined,
        undefined,
        companyAttributeDefs
      )
      expect([...resolved.operators]).toEqual([
        'eq',
        'neq',
        'gt',
        'gte',
        'lt',
        'lte',
        'is_set',
        'is_empty',
      ])
      expect(resolved.kind).toBe('number')
    })

    it('falls back to every operator for an unresolved person/company attribute key', () => {
      const resolved = resolveConditionField(
        personAttributeFieldForKey('nope'),
        undefined,
        undefined,
        personAttributeDefs
      )
      expect(resolved.unresolved).toBe(true)
      expect(resolved.operators.length).toBeGreaterThan(6)
    })

    it('person.email resolves as a static text field', () => {
      const resolved = resolveConditionField('person.email')
      expect(resolved.kind).toBe('text')
      expect(resolved.operators).toEqual([
        'contains',
        'not_contains',
        'eq',
        'neq',
        'is_set',
        'is_empty',
      ])
    })
  })

  describe('draft <-> condition round-trip', () => {
    it('round-trips a string eq condition', () => {
      const leaf: GraphCondition = { field: 'person.attr.plan', op: 'eq', value: 'enterprise' }
      const draft = conditionToDraft(leaf)
      if (draft.kind !== 'simple') throw new Error('expected simple draft')
      expect(draft.rules[0]).toEqual({ field: 'person.attr.plan', op: 'eq', value: 'enterprise' })
      expect(draftToCondition(draft, undefined, personAttributeDefs)).toEqual(leaf)
    })

    it('round-trips a boolean eq condition as a real boolean, not the string "true"', () => {
      const leaf: GraphCondition = { field: 'person.attr.is_champion', op: 'eq', value: true }
      const draft = conditionToDraft(leaf)
      if (draft.kind !== 'simple') throw new Error('expected simple draft')
      expect(draft.rules[0]?.value).toBe('true')
      const rebuilt = draftToCondition(draft, undefined, personAttributeDefs)
      expect(rebuilt).toEqual(leaf)
      if ('field' in rebuilt) expect(typeof rebuilt.value).toBe('boolean')
    })

    it('round-trips a number condition', () => {
      const leaf: GraphCondition = { field: 'person.attr.seats', op: 'gte', value: 5 }
      const draft = conditionToDraft(leaf)
      if (draft.kind !== 'simple') throw new Error('expected simple draft')
      expect(draftToCondition(draft, undefined, personAttributeDefs)).toEqual(leaf)
    })

    it('round-trips a company.attr currency condition', () => {
      const leaf: GraphCondition = { field: 'company.attr.arr', op: 'gte', value: 100000 }
      const draft = conditionToDraft(leaf)
      if (draft.kind !== 'simple') throw new Error('expected simple draft')
      expect(draftToCondition(draft, undefined, undefined, companyAttributeDefs)).toEqual(leaf)
    })

    it('round-trips person.email', () => {
      const leaf: GraphCondition = { field: 'person.email', op: 'contains', value: '@acme.com' }
      const draft = conditionToDraft(leaf)
      if (draft.kind !== 'simple') throw new Error('expected simple draft')
      expect(draftToCondition(draft)).toEqual(leaf)
    })

    it('is_set/is_empty carry no value either direction', () => {
      const leaf: GraphCondition = { field: 'company.attr.tier', op: 'is_set' }
      const draft = conditionToDraft(leaf)
      if (draft.kind !== 'simple') throw new Error('expected simple draft')
      expect(draft.rules[0]?.value).toBe('')
      expect(draftToCondition(draft, undefined, undefined, companyAttributeDefs)).toEqual(leaf)
    })
  })

  describe('conditionSummary label resolution', () => {
    it('renders the definition label, not the raw key, for a person.attr condition', () => {
      const condition: GraphCondition = { field: 'person.attr.plan', op: 'eq', value: 'enterprise' }
      expect(conditionSummary(condition, undefined, undefined, personAttributeDefs)).toBe(
        'Plan is enterprise'
      )
    })

    it('renders the definition label for a company.attr condition', () => {
      const condition: GraphCondition = { field: 'company.attr.tier', op: 'eq', value: 'gold' }
      expect(
        conditionSummary(condition, undefined, undefined, undefined, companyAttributeDefs)
      ).toBe('Tier is gold')
    })

    it('falls back to the raw key when the definition is missing', () => {
      const condition: GraphCondition = { field: 'person.attr.retired_key', op: 'is_set' }
      expect(conditionSummary(condition)).toBe('Unknown attribute retired_key is set')
    })

    it('renders person.email using its static label', () => {
      const condition: GraphCondition = {
        field: 'person.email',
        op: 'contains',
        value: '@acme.com',
      }
      expect(conditionSummary(condition)).toBe('Person email contains @acme.com')
    })
  })

  describe('server schema parity via validateGraph', () => {
    it('accepts a condition node using person.attr / company.attr / person.email', () => {
      const graph = {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'x',
            type: 'condition',
            condition: {
              all: [
                { field: 'person.attr.plan', op: 'eq', value: 'enterprise' },
                { field: 'company.attr.tier', op: 'eq', value: 'gold' },
                { field: 'person.email', op: 'contains', value: '@acme.com' },
              ],
            },
          },
        ],
        edges: [{ from: 'trigger', to: 'x' }],
      }
      expect(validateGraph(graph).ok).toBe(true)
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

  it('add_note: defaults to an empty body, summarizes/truncates it, and flags a blank one as an issue', () => {
    expect(defaultAction('add_note')).toEqual({ type: 'add_note', body: '' })
    expect(actionSummary({ type: 'add_note', body: '' })).toBe('Add a note…')
    expect(actionSummary({ type: 'add_note', body: 'Escalated to VIP' })).toBe(
      'Note: Escalated to VIP'
    )
    expect(actionSummary({ type: 'add_note', body: 'x'.repeat(80) })).toBe(
      `Note: ${'x'.repeat(57)}...`
    )
    expect(actionIssue({ type: 'add_note', body: '' })).toBe('Write the note')
    expect(actionIssue({ type: 'add_note', body: '   ' })).toBe('Write the note')
    expect(actionIssue({ type: 'add_note', body: 'Escalated to VIP' })).toBeNull()
  })

  it('add_note: validateGraph accepts a written note, rejects a blank one', () => {
    const graphOk = {
      nodes: [{ id: 'a', type: 'action', action: { type: 'add_note', body: 'Escalated to VIP' } }],
      edges: [],
    }
    expect(validateGraph(graphOk).ok).toBe(true)

    const graphBad = {
      nodes: [{ id: 'a', type: 'action', action: { type: 'add_note', body: '' } }],
      edges: [],
    }
    const result = validateGraph(graphBad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/write the note/)
  })

  it('set_ticket_status: defaults to an unset statusId, summarizes with the labels map, and flags an unset one as an issue', () => {
    expect(defaultAction('set_ticket_status')).toEqual({ type: 'set_ticket_status', statusId: '' })
    expect(actionSummary({ type: 'set_ticket_status', statusId: '' })).toBe(
      'Set ticket status to a status…'
    )
    expect(
      actionSummary(
        { type: 'set_ticket_status', statusId: 'ticket_status_1' },
        { ticketStatuses: new Map([['ticket_status_1', 'Resolved']]) }
      )
    ).toBe('Set ticket status to Resolved')
    expect(actionIssue({ type: 'set_ticket_status', statusId: '' })).toBe('Choose a ticket status')
    expect(actionIssue({ type: 'set_ticket_status', statusId: 'ticket_status_1' })).toBeNull()
  })

  it('set_ticket_status: validateGraph accepts a chosen status, rejects an unset one', () => {
    const graphOk = {
      nodes: [
        { id: 'a', type: 'action', action: { type: 'set_ticket_status', statusId: 'status_1' } },
      ],
      edges: [],
    }
    expect(validateGraph(graphOk).ok).toBe(true)

    const graphBad = {
      nodes: [{ id: 'a', type: 'action', action: { type: 'set_ticket_status', statusId: '' } }],
      edges: [],
    }
    const result = validateGraph(graphBad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/choose a ticket status/)
  })

  it('convert_to_ticket: has no settings, summarizes as a plain phrase, and never has an issue', () => {
    expect(defaultAction('convert_to_ticket')).toEqual({ type: 'convert_to_ticket' })
    expect(actionSummary({ type: 'convert_to_ticket' })).toBe('Convert to a ticket')
    expect(actionIssue({ type: 'convert_to_ticket' })).toBeNull()
  })

  it('convert_to_ticket: validateGraph accepts the bare action', () => {
    const graph = {
      nodes: [{ id: 'a', type: 'action', action: { type: 'convert_to_ticket' } }],
      edges: [],
    }
    expect(validateGraph(graph).ok).toBe(true)
  })

  it('the two ticket triggers are pickable, with labels, in TRIGGER_TYPES/TRIGGER_LABELS', () => {
    expect(TRIGGER_TYPES).toContain('ticket.created')
    expect(TRIGGER_TYPES).toContain('ticket.status_changed')
    expect(TRIGGER_LABELS['ticket.created']).toBe('Ticket created')
    expect(TRIGGER_LABELS['ticket.status_changed']).toBe('Ticket status changed')
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

// ---------------------------------------------------------------------------
// Conversational block kinds (Phase C, slice C-5): the 8 node kinds C-1 added
// to the runtime become first-class in the visual builder here — round-trips
// through the tree, server-schema parity, and the issues-gate rules.
// ---------------------------------------------------------------------------

describe('conversational block kinds', () => {
  const withBody = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })

  it.each([
    ['message', { id: 'm1', kind: 'message', body: withBody('Hi there') }],
    ['show_reply_time', { id: 'r1', kind: 'show_reply_time' }],
    ['disable_composer', { id: 'd1', kind: 'disable_composer' }],
    [
      'collect_data',
      {
        id: 'c1',
        kind: 'collect_data',
        body: withBody('What is your order number?'),
        attributeKey: 'order_id',
        fieldType: 'text',
        required: true,
      },
    ],
    [
      'collect_reply',
      { id: 'c2', kind: 'collect_reply', body: withBody('Anything else?'), attributeKey: 'notes' },
    ],
  ])('round-trips a linear %s step', (_name, step) => {
    const tree: WorkflowTree = { triggerId: 'trigger', steps: [step as TreeStep] }
    const graph = treeToGraph(tree)
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
    expect(graphToTree(graph)).toEqual({ ok: true, value: tree })
  })

  it('round-trips reply_buttons, spawning one labeled path per button key', () => {
    const tree: WorkflowTree = {
      triggerId: 'trigger',
      steps: [
        {
          id: 'buttons-1',
          kind: 'reply_buttons',
          body: withBody('How can we help?'),
          allowTyping: false,
          paths: [
            {
              key: 'billing',
              label: 'Billing',
              steps: [
                { id: 'a1', kind: 'action', action: { type: 'add_tag', tagId: 'tag_billing' } },
              ],
            },
            { key: 'other', label: 'Something else', steps: [] },
          ],
        },
      ],
    }
    const graph = treeToGraph(tree)
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
    expect(graph.nodes).toContainEqual({
      id: 'buttons-1',
      type: 'reply_buttons',
      body: withBody('How can we help?'),
      options: [
        { key: 'billing', label: 'Billing' },
        { key: 'other', label: 'Something else' },
      ],
      allowTyping: false,
    })
    expect(graph.edges).toContainEqual({ from: 'buttons-1', to: 'a1', branch: 'billing' })
    expect(graphToTree(graph)).toEqual({ ok: true, value: tree })
  })

  it('round-trips request_csat, spawning a path only for wired rating digits', () => {
    const csatStep: Extract<TreeStep, { kind: 'request_csat' }> = {
      id: 'csat-1',
      kind: 'request_csat',
      body: withBody('How did we do?'),
      allowTypingInterrupt: true,
      commentPrompt: 'Tell us more',
      paths: [
        {
          key: '1',
          label: RATING_LABELS['1'],
          steps: [{ id: 'a1', kind: 'action', action: { type: 'set_priority', priority: 'high' } }],
        },
        { key: '5', label: RATING_LABELS['5'], steps: [] },
      ],
    }
    const tree: WorkflowTree = { triggerId: 'trigger', steps: [csatStep] }
    const graph = treeToGraph(tree)
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
    // Rating '5' has no steps, so treeToGraph emits no edge for it (same as a
    // branch path with 0 steps) — the resume path still records the rating.
    expect(graph.edges.some((e) => e.branch === '5')).toBe(false)
    expect(graph.edges).toContainEqual({ from: 'csat-1', to: 'a1', branch: '1' })
    // Unlike a `branch` node (whose paths are DECLARED on the node itself,
    // independent of edges), request_csat has no declared-keys field — a
    // wired-but-empty rating path is therefore only representable in the
    // tree while it has at least one step; without an edge to discover it
    // from, it doesn't survive a graph round-trip. Documented limitation:
    // the CSAT editor should nudge admins to fill a newly added rating path
    // rather than leave it empty across a JSON-mode round-trip.
    const back = graphToTree(graph)
    expect(back).toEqual({
      ok: true,
      value: { ...tree, steps: [{ ...csatStep, paths: [csatStep.paths[0]] }] },
    })
  })

  it('round-trips let_assistant_answer: default edge unlabeled, escalated edge labeled', () => {
    const tree: WorkflowTree = {
      triggerId: 'trigger',
      steps: [
        {
          id: 'quinn-1',
          kind: 'let_assistant_answer',
          paths: [
            {
              key: LET_ASSISTANT_DEFAULT_KEY,
              label: 'Continues',
              steps: [{ id: 'a1', kind: 'action', action: { type: 'close' } }],
            },
            {
              key: LET_ASSISTANT_ESCALATED_KEY,
              label: 'If escalated to a human',
              steps: [{ id: 'a2', kind: 'action', action: { type: 'assign_team', teamId: 't_1' } }],
            },
          ],
        },
      ],
    }
    const graph = treeToGraph(tree)
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
    expect(graph.edges).toContainEqual({ from: 'quinn-1', to: 'a1' })
    expect(graph.edges).toContainEqual({ from: 'quinn-1', to: 'a2', branch: 'escalated' })
    expect(graphToTree(graph)).toEqual({ ok: true, value: tree })
  })

  it('round-trips let_assistant_answer instructions + autoCloseOverride (Phase C, slice C-6)', () => {
    const tree: WorkflowTree = {
      triggerId: 'trigger',
      steps: [
        {
          id: 'quinn-1',
          kind: 'let_assistant_answer',
          instructions: 'Focus on billing only',
          autoCloseOverride: true,
          paths: [
            { key: LET_ASSISTANT_DEFAULT_KEY, label: 'Continues', steps: [] },
            { key: LET_ASSISTANT_ESCALATED_KEY, label: 'If escalated to a human', steps: [] },
          ],
        },
      ],
    }
    const graph = treeToGraph(tree)
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
    const node = graph.nodes.find((n) => n.id === 'quinn-1')
    expect(node).toMatchObject({ instructions: 'Focus on billing only', autoCloseOverride: true })
    expect(graphToTree(graph)).toEqual({ ok: true, value: tree })
  })

  it('let_assistant_answer with no escalated edge still round-trips (server-authored graphs are optional there)', () => {
    const graph: WorkflowGraphJson = {
      nodes: [
        { id: 'trigger', type: 'trigger' },
        { id: 'quinn-1', type: 'let_assistant_answer' },
        { id: 'a1', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 'trigger', to: 'quinn-1' },
        { from: 'quinn-1', to: 'a1' },
      ],
    }
    const tree = graphToTree(graph)
    expect(tree.ok).toBe(true)
    if (!tree.ok) return
    const step = tree.value.steps[0]
    if (step?.kind !== 'let_assistant_answer') throw new Error('expected let_assistant_answer')
    expect(step.paths.find((p) => p.key === LET_ASSISTANT_ESCALATED_KEY)?.steps).toEqual([])
  })

  it('createStep produces a tree-representable step for every new kind, flagged by collectStepIssues where setup is still needed', () => {
    const tree = newTree()
    // Defaults that ship with a real value need no setup (show_reply_time,
    // let_assistant_answer have no config at all); the rest start with an
    // empty body, an unset attribute/button set, or (disable_composer,
    // alone with no sibling) trip amendment 3's standalone warning — same
    // spirit as an "Assign to teammate" action step defaulting to an unset
    // teammate.
    const needsSetup: readonly TreeStep['kind'][] = [
      'message',
      'disable_composer',
      'collect_data',
      'collect_reply',
      'reply_buttons',
      'request_csat',
    ]
    for (const kind of [
      'message',
      'show_reply_time',
      'disable_composer',
      'collect_data',
      'collect_reply',
      'let_assistant_answer',
      'reply_buttons',
      'request_csat',
    ] as const) {
      const step = createStep(tree, kind)
      const oneStepTree: WorkflowTree = { triggerId: 'trigger', steps: [step] }
      const roundTripped = graphToTree(treeToGraph(oneStepTree))
      expect(roundTripped, kind).toEqual({ ok: true, value: oneStepTree })
      const issues = collectStepIssues(oneStepTree)
      expect(issues.has(step.id), `${kind} setup-needed mismatch`).toBe(needsSetup.includes(kind))
    }
  })

  describe('validateGraph mirrors the server schema for the new kinds', () => {
    const trigger = { id: 'trigger', type: 'trigger' } as const

    it('rejects a reply_buttons step with zero options', () => {
      const graph = {
        nodes: [
          trigger,
          {
            id: 'x',
            type: 'reply_buttons',
            body: EMPTY_BLOCK_BODY,
            options: [],
            allowTyping: false,
          },
        ],
        edges: [{ from: 'trigger', to: 'x' }],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(false)
      const result = validateGraph(graph)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/at least one button/)
    })

    it('rejects a collect_data step with no attributeKey', () => {
      const graph = {
        nodes: [
          trigger,
          {
            id: 'x',
            type: 'collect_data',
            body: EMPTY_BLOCK_BODY,
            attributeKey: '',
            fieldType: 'text',
            required: false,
          },
        ],
        edges: [{ from: 'trigger', to: 'x' }],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(false)
      const result = validateGraph(graph)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/choose an attribute/)
    })

    it('rejects a message step with a bodyless (non-object) body', () => {
      const graph = {
        nodes: [trigger, { id: 'x', type: 'message', body: null }],
        edges: [{ from: 'trigger', to: 'x' }],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(false)
      expect(validateGraph(graph).ok).toBe(false)
    })

    it('rejects an edge off a reply_buttons node for an undeclared button key', () => {
      const graph = {
        nodes: [
          trigger,
          {
            id: 'x',
            type: 'reply_buttons',
            body: EMPTY_BLOCK_BODY,
            options: [{ key: 'a', label: 'A' }],
            allowTyping: false,
          },
          { id: 'y', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 'trigger', to: 'x' },
          { from: 'x', to: 'y', branch: 'b' },
        ],
      }
      const result = validateGraph(graph)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/undeclared path "b"/)
    })
  })

  describe("graphToTree falls back to JSON for shapes the tree can't express", () => {
    it('a request_csat edge with an out-of-range rating label', () => {
      const graph: WorkflowGraphJson = {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'csat-1',
            type: 'request_csat',
            body: EMPTY_BLOCK_BODY,
            allowTypingInterrupt: true,
          },
          { id: 'a1', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 'trigger', to: 'csat-1' },
          { from: 'csat-1', to: 'a1', branch: '6' },
        ],
      }
      const result = graphToTree(graph)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/unexpected label/)
    })

    it('two rating digits merging into the same downstream node (a valid graph, not tree-representable)', () => {
      const graph: WorkflowGraphJson = {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'csat-1',
            type: 'request_csat',
            body: EMPTY_BLOCK_BODY,
            allowTypingInterrupt: true,
          },
          { id: 'a1', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 'trigger', to: 'csat-1' },
          { from: 'csat-1', to: 'a1', branch: '1' },
          { from: 'csat-1', to: 'a1', branch: '2' },
        ],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
      expect(graphToTree(graph).ok).toBe(false)
    })
  })

  describe('collectStepIssues rules for the new kinds', () => {
    it('flags an empty message body', () => {
      const tree: WorkflowTree = {
        triggerId: 'trigger',
        steps: [{ id: 'm1', kind: 'message', body: EMPTY_BLOCK_BODY }],
      }
      expect(collectStepIssues(tree).get('m1')).toMatch(/Write the message/)
    })

    it('flags zero buttons on a reply_buttons step', () => {
      const tree: WorkflowTree = {
        triggerId: 'trigger',
        steps: [
          {
            id: 'b1',
            kind: 'reply_buttons',
            body: withBody('Pick one'),
            allowTyping: false,
            paths: [],
          },
        ],
      }
      expect(collectStepIssues(tree).get('b1')).toMatch(/at least one button/)
    })

    it('flags collect_data / collect_reply with no attribute chosen', () => {
      const tree: WorkflowTree = {
        triggerId: 'trigger',
        steps: [
          {
            id: 'c1',
            kind: 'collect_data',
            body: withBody('What is your order number?'),
            attributeKey: '',
            fieldType: 'text',
            required: false,
          },
          {
            id: 'c2',
            kind: 'collect_reply',
            body: withBody('Anything else?'),
            attributeKey: '',
          },
        ],
      }
      const issues = collectStepIssues(tree)
      expect(issues.get('c1')).toMatch(/Choose an attribute/)
      expect(issues.get('c2')).toMatch(/Choose an attribute/)
    })

    it('warns on a standalone disable_composer with no adjacent interactive block (amendment 3)', () => {
      const tree: WorkflowTree = {
        triggerId: 'trigger',
        steps: [{ id: 'dc1', kind: 'disable_composer' }],
      }
      expect(collectStepIssues(tree).get('dc1')).toMatch(/reply-buttons or rating step/)
    })

    it('does not warn on a disable_composer adjacent to reply_buttons', () => {
      const tree: WorkflowTree = {
        triggerId: 'trigger',
        steps: [
          { id: 'dc1', kind: 'disable_composer' },
          {
            id: 'b1',
            kind: 'reply_buttons',
            body: withBody('Pick one'),
            allowTyping: false,
            paths: [],
          },
        ],
      }
      // b1 itself still has an issue (zero buttons) but dc1 should not.
      expect(collectStepIssues(tree).get('dc1')).toBeUndefined()
    })

    // Phase C, slice C-6: parking kinds are only legal in a customer_facing
    // workflow (mirrors workflow.schemas.ts's classRestrictedNodeIssue).
    describe('class rule for parking blocks', () => {
      it('defaults to customer_facing (permissive) when no class is passed, for backward compatibility', () => {
        const tree: WorkflowTree = {
          triggerId: 'trigger',
          steps: [
            {
              id: 'csat',
              kind: 'request_csat',
              body: withBody('Rate us'),
              allowTypingInterrupt: true,
              paths: [],
            },
          ],
        }
        expect(collectStepIssues(tree).get('csat')).toBeUndefined()
      })

      it('flags a parking-kind step (request_csat) in a background workflow', () => {
        const tree: WorkflowTree = {
          triggerId: 'trigger',
          steps: [
            {
              id: 'csat',
              kind: 'request_csat',
              body: withBody('Rate us'),
              allowTypingInterrupt: true,
              paths: [],
            },
          ],
        }
        expect(collectStepIssues(tree, 'background').get('csat')).toMatch(/customer-facing/)
      })

      it('does not flag message/show_reply_time in a background workflow', () => {
        const tree: WorkflowTree = {
          triggerId: 'trigger',
          steps: [
            { id: 'm1', kind: 'message', body: withBody('Hello') },
            { id: 'rt1', kind: 'show_reply_time' },
          ],
        }
        const issues = collectStepIssues(tree, 'background')
        expect(issues.get('m1')).toBeUndefined()
        expect(issues.get('rt1')).toBeUndefined()
      })

      it('the class-rule issue wins over a more specific per-kind issue for the same step', () => {
        const tree: WorkflowTree = {
          triggerId: 'trigger',
          steps: [
            {
              id: 'b1',
              kind: 'reply_buttons',
              body: EMPTY_BLOCK_BODY,
              allowTyping: false,
              paths: [],
            },
          ],
        }
        // b1 has both an empty body AND zero buttons — but in a background
        // workflow the "wrong workflow entirely" issue should surface first.
        expect(collectStepIssues(tree, 'background').get('b1')).toMatch(/customer-facing/)
      })
    })
  })

  describe('draftIssues class rule (Phase C, slice C-6)', () => {
    it('JSON mode: a parking-kind node in a background workflow is a blocking issue', () => {
      const graph: WorkflowGraphJson = {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'csat',
            type: 'request_csat',
            body: EMPTY_BLOCK_BODY,
            allowTypingInterrupt: true,
          },
        ],
        edges: [{ from: 'trigger', to: 'csat' }],
      }
      const result = draftIssues({ mode: 'json', text: JSON.stringify(graph) }, 'background')
      expect(result.blocking).toMatch(/customer_facing/)
    })

    it('JSON mode: the same graph is clean under customer_facing', () => {
      const graph: WorkflowGraphJson = {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'csat',
            type: 'request_csat',
            body: EMPTY_BLOCK_BODY,
            allowTypingInterrupt: true,
          },
        ],
        edges: [{ from: 'trigger', to: 'csat' }],
      }
      const result = draftIssues({ mode: 'json', text: JSON.stringify(graph) }, 'customer_facing')
      expect(result.blocking).toBeNull()
    })
  })

  describe('insertVariableToken', () => {
    it('appends a {key|} token to the last paragraph of a non-empty body', () => {
      const body = withBody('Hi')
      const next = insertVariableToken(body, 'first_name')
      expect(next).toEqual({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Hi' },
              { type: 'text', text: '{first_name|}' },
            ],
          },
        ],
      })
    })

    it('fills the empty paragraph of a blank body rather than adding a second one', () => {
      const next = insertVariableToken(EMPTY_BLOCK_BODY, 'email')
      expect(next).toEqual({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '{email|}' }] }],
      })
    })

    it('starts a fresh paragraph when the body has no paragraph to append to', () => {
      const body = { type: 'doc', content: [{ type: 'horizontalRule' }] }
      const next = insertVariableToken(body, 'email')
      expect(next).toEqual({
        type: 'doc',
        content: [
          { type: 'horizontalRule' },
          { type: 'paragraph', content: [{ type: 'text', text: '{email|}' }] },
        ],
      })
    })
  })
})

describe('call_connector node', () => {
  it('round-trips: default (unlabeled) success edge + labeled "failed" edge', () => {
    const tree: WorkflowTree = {
      triggerId: 'trigger',
      steps: [
        {
          id: 'cc-1',
          kind: 'call_connector',
          connectorId: 'data_connector_1',
          params: { ticket_id: '{first_name|there}' },
          paths: [
            {
              key: CALL_CONNECTOR_SUCCESS_KEY,
              label: 'On success',
              steps: [{ id: 'a1', kind: 'action', action: { type: 'close' } }],
            },
            {
              key: CALL_CONNECTOR_FAILED_KEY,
              label: 'On failure',
              steps: [{ id: 'a2', kind: 'action', action: { type: 'assign_team', teamId: 't_1' } }],
            },
          ],
        },
      ],
    }
    const graph = treeToGraph(tree)
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
    expect(graph.edges).toContainEqual({ from: 'cc-1', to: 'a1' })
    expect(graph.edges).toContainEqual({
      from: 'cc-1',
      to: 'a2',
      branch: CALL_CONNECTOR_FAILED_KEY,
    })
    expect(graph.nodes).toContainEqual({
      id: 'cc-1',
      type: 'call_connector',
      connectorId: 'data_connector_1',
      params: { ticket_id: '{first_name|there}' },
      timeoutMs: undefined,
    })
    expect(graphToTree(graph)).toEqual({ ok: true, value: tree })
  })

  it('round-trips an optional timeoutMs', () => {
    const tree: WorkflowTree = {
      triggerId: 'trigger',
      steps: [
        {
          id: 'cc-1',
          kind: 'call_connector',
          connectorId: 'data_connector_1',
          params: {},
          timeoutMs: 5000,
          paths: [
            { key: CALL_CONNECTOR_SUCCESS_KEY, label: 'On success', steps: [] },
            { key: CALL_CONNECTOR_FAILED_KEY, label: 'On failure', steps: [] },
          ],
        },
      ],
    }
    const graph = treeToGraph(tree)
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
    const node = graph.nodes.find((n) => n.id === 'cc-1')
    expect(node).toMatchObject({ timeoutMs: 5000 })
    expect(graphToTree(graph)).toEqual({ ok: true, value: tree })
  })

  it('a server-authored graph with no failed edge still round-trips (the failed path is optional)', () => {
    const graph: WorkflowGraphJson = {
      nodes: [
        { id: 'trigger', type: 'trigger' },
        { id: 'cc-1', type: 'call_connector', connectorId: 'data_connector_1', params: {} },
        { id: 'a1', type: 'action', action: { type: 'close' } },
      ],
      edges: [
        { from: 'trigger', to: 'cc-1' },
        { from: 'cc-1', to: 'a1' },
      ],
    }
    const tree = graphToTree(graph)
    expect(tree.ok).toBe(true)
    if (!tree.ok) return
    const step = tree.value.steps[0]
    if (step?.kind !== 'call_connector') throw new Error('expected call_connector')
    expect(step.paths.find((p) => p.key === CALL_CONNECTOR_FAILED_KEY)?.steps).toEqual([])
  })

  it('createStep seeds both paths, an empty connectorId/params, and no timeoutMs; round-trips; flagged by collectStepIssues (needs a connector)', () => {
    const tree = newTree()
    const step = createStep(tree, 'call_connector')
    expect(step).toMatchObject({ kind: 'call_connector', connectorId: '', params: {} })
    expect(step).not.toHaveProperty('timeoutMs')
    const oneStepTree: WorkflowTree = { triggerId: 'trigger', steps: [step] }
    expect(graphToTree(treeToGraph(oneStepTree))).toEqual({ ok: true, value: oneStepTree })
    expect(collectStepIssues(oneStepTree).get(step.id)).toMatch(/Choose a connector/)
  })

  describe('validateGraph mirrors the server schema', () => {
    const trigger = { id: 'trigger', type: 'trigger' } as const

    it('rejects an empty connectorId', () => {
      const graph = {
        nodes: [trigger, { id: 'x', type: 'call_connector', connectorId: '', params: {} }],
        edges: [{ from: 'trigger', to: 'x' }],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(false)
      const result = validateGraph(graph)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/choose a connector/)
    })

    it('rejects a non-string params value', () => {
      const graph = {
        nodes: [
          trigger,
          {
            id: 'x',
            type: 'call_connector',
            connectorId: 'data_connector_1',
            params: { count: 5 },
          },
        ],
        edges: [{ from: 'trigger', to: 'x' }],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(false)
      expect(validateGraph(graph).ok).toBe(false)
    })

    it('rejects a timeoutMs out of bounds, accepts one at the bounds', () => {
      const withTimeout = (timeoutMs: number) => ({
        nodes: [
          trigger,
          {
            id: 'x',
            type: 'call_connector',
            connectorId: 'data_connector_1',
            params: {},
            timeoutMs,
          },
        ],
        edges: [{ from: 'trigger', to: 'x' }],
      })
      expect(
        workflowGraphSchema.safeParse(withTimeout(MIN_CALL_CONNECTOR_TIMEOUT_MS)).success
      ).toBe(true)
      expect(validateGraph(withTimeout(MIN_CALL_CONNECTOR_TIMEOUT_MS)).ok).toBe(true)
      expect(
        workflowGraphSchema.safeParse(withTimeout(MAX_CALL_CONNECTOR_TIMEOUT_MS + 1)).success
      ).toBe(false)
      expect(validateGraph(withTimeout(MAX_CALL_CONNECTOR_TIMEOUT_MS + 1)).ok).toBe(false)
    })

    it('rejects an edge off a call_connector node for an undeclared branch key (only "failed" is declared)', () => {
      const graph = {
        nodes: [
          trigger,
          { id: 'x', type: 'call_connector', connectorId: 'data_connector_1', params: {} },
          { id: 'y', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 'trigger', to: 'x' },
          { from: 'x', to: 'y', branch: 'oops' },
        ],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(false)
      const result = validateGraph(graph)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/undeclared path/)
    })

    it('accepts the declared "failed" branch key and an unlabeled default edge', () => {
      const graph = {
        nodes: [
          trigger,
          { id: 'x', type: 'call_connector', connectorId: 'data_connector_1', params: {} },
          { id: 'y', type: 'action', action: { type: 'close' } },
          { id: 'z', type: 'action', action: { type: 'reopen' } },
        ],
        edges: [
          { from: 'trigger', to: 'x' },
          { from: 'x', to: 'y' },
          { from: 'x', to: 'z', branch: CALL_CONNECTOR_FAILED_KEY },
        ],
      }
      expect(workflowGraphSchema.safeParse(graph).success).toBe(true)
      expect(validateGraph(graph).ok).toBe(true)
    })
  })

  describe('collectStepIssues (Choose a connector / Map the required inputs)', () => {
    it('flags an unset connectorId', () => {
      const tree: WorkflowTree = {
        triggerId: 'trigger',
        steps: [{ id: 'cc', kind: 'call_connector', connectorId: '', params: {}, paths: [] }],
      }
      expect(collectStepIssues(tree).get('cc')).toMatch(/Choose a connector/)
    })

    it('a needs-setup-template connectorId also reads as unset', () => {
      const tree: WorkflowTree = {
        triggerId: 'trigger',
        steps: [
          {
            id: 'cc',
            kind: 'call_connector',
            connectorId: `${NEEDS_SETUP_PREFIX}connector`,
            params: {},
            paths: [],
          },
        ],
      }
      expect(isNeedsSetupRef(`${NEEDS_SETUP_PREFIX}connector`)).toBe(true)
      expect(collectStepIssues(tree).get('cc')).toMatch(/Choose a connector/)
    })

    it('flags a chosen connector with an unmapped required input', () => {
      const tree: WorkflowTree = {
        triggerId: 'trigger',
        steps: [
          {
            id: 'cc',
            kind: 'call_connector',
            connectorId: 'data_connector_1',
            params: {},
            paths: [],
          },
        ],
      }
      const connectors = new Map<string, ConnectorMeta>([
        ['data_connector_1', { requiredInputNames: ['ticket_id'] }],
      ])
      expect(collectStepIssues(tree, 'customer_facing', connectors).get('cc')).toMatch(
        /Map the required inputs/
      )
    })

    it('no issue once every required input has a non-blank mapping', () => {
      const tree: WorkflowTree = {
        triggerId: 'trigger',
        steps: [
          {
            id: 'cc',
            kind: 'call_connector',
            connectorId: 'data_connector_1',
            params: { ticket_id: '{conversation.id}' },
            paths: [],
          },
        ],
      }
      const connectors = new Map<string, ConnectorMeta>([
        ['data_connector_1', { requiredInputNames: ['ticket_id'] }],
      ])
      expect(collectStepIssues(tree, 'customer_facing', connectors).get('cc')).toBeUndefined()
    })

    it('no issue for a connector id absent from the supplied metadata map (nothing more to check)', () => {
      const tree: WorkflowTree = {
        triggerId: 'trigger',
        steps: [
          {
            id: 'cc',
            kind: 'call_connector',
            connectorId: 'data_connector_unknown',
            params: {},
            paths: [],
          },
        ],
      }
      expect(collectStepIssues(tree, 'customer_facing', new Map()).get('cc')).toBeUndefined()
    })

    it('legal in a background workflow — NOT restricted like the PARKING_BLOCK_KINDS (its park is engine-internal, never externally resumed)', () => {
      const tree: WorkflowTree = {
        triggerId: 'trigger',
        steps: [
          {
            id: 'cc',
            kind: 'call_connector',
            connectorId: 'data_connector_1',
            params: {},
            paths: [],
          },
        ],
      }
      expect(collectStepIssues(tree, 'background').get('cc')).toBeUndefined()
    })
  })

  describe('callConnectorSummary / stepLabel', () => {
    it('shows "not chosen yet" when unset, the connector name when set + known, and the outline reflects it', () => {
      const unset: Extract<TreeStep, { kind: 'call_connector' }> = {
        id: 'cc',
        kind: 'call_connector',
        connectorId: '',
        params: {},
        paths: [
          { key: CALL_CONNECTOR_SUCCESS_KEY, label: 'On success', steps: [] },
          { key: CALL_CONNECTOR_FAILED_KEY, label: 'On failure', steps: [] },
        ],
      }
      expect(callConnectorSummary(unset)).toBe('Call … not chosen yet')

      const set: Extract<TreeStep, { kind: 'call_connector' }> = {
        ...unset,
        connectorId: 'data_connector_1',
      }
      expect(callConnectorSummary(set, new Map([['data_connector_1', 'Zendesk lookup']]))).toBe(
        'Call Zendesk lookup'
      )

      const tree: WorkflowTree = { triggerId: 'trigger', steps: [set] }
      const outline = deriveOutline(tree, 'New conversation', new Map(), {
        connectors: new Map([['data_connector_1', 'Zendesk lookup']]),
      })
      const row = outline.find((e) => 'id' in e && e.id === 'cc')
      expect(row).toMatchObject({ label: 'Call Zendesk lookup' })
    })
  })
})

describe('audienceUnreachableFieldWarning', () => {
  const messageRule: GraphCondition = { field: 'message.body', op: 'contains', value: 'refund' }

  it('warns when a message.* rule is on a trigger whose event never carries a message', () => {
    expect(audienceUnreachableFieldWarning('conversation.created', messageRule)).toMatch(
      /never carries one — it will never match/
    )
  })

  it('warns for message.sender the same way as message.body', () => {
    const rule: GraphCondition = { field: 'message.sender', op: 'eq', value: 'visitor' }
    expect(audienceUnreachableFieldWarning('conversation.attribute_changed', rule)).not.toBeNull()
  })

  it('finds a message.* rule nested inside an all/any group, not just a bare leaf', () => {
    const nested: GraphCondition = {
      any: [{ all: [{ field: 'conversation.priority', op: 'eq', value: 'high' }, messageRule] }],
    }
    expect(audienceUnreachableFieldWarning('sla.breached', nested)).not.toBeNull()
  })

  it('every timer trigger (all 4) and attribute_changed/created/status_changed/assigned/priority_changed/csat_submitted/handed_off warn — none of them carry a message', () => {
    const nonMessageTriggers = [
      'conversation.created',
      'conversation.status_changed',
      'conversation.assigned',
      'conversation.priority_changed',
      'conversation.attribute_changed',
      'conversation.csat_submitted',
      'assistant.handed_off',
      'conversation.customer_unresponsive',
      'conversation.teammate_unresponsive',
      'sla.approaching_breach',
      'sla.breached',
    ]
    for (const triggerType of nonMessageTriggers) {
      expect(audienceUnreachableFieldWarning(triggerType, messageRule)).not.toBeNull()
    }
  })

  it('stays silent for the two triggers that actually carry a message', () => {
    expect(audienceUnreachableFieldWarning('message.created', messageRule)).toBeNull()
    expect(audienceUnreachableFieldWarning('message.note_created', messageRule)).toBeNull()
  })

  it('stays silent when the audience never references a message.* field', () => {
    const rule: GraphCondition = { field: 'conversation.priority', op: 'eq', value: 'high' }
    expect(audienceUnreachableFieldWarning('conversation.created', rule)).toBeNull()
  })

  it('stays silent with no audience configured at all', () => {
    expect(audienceUnreachableFieldWarning('conversation.created', undefined)).toBeNull()
    expect(audienceUnreachableFieldWarning('conversation.created', {})).toBeNull()
  })
})
