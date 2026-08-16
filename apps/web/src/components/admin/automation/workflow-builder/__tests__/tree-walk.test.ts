/**
 * Tree-walk coverage for the step list: trunk + fork derivation (no geometry),
 * gallery-template round trips, and lane-tab keys. describeBranchPath lives
 * on step-content and is asserted here so the card copy stays pinned.
 */
import { describe, expect, it } from 'vitest'
import {
  LET_ASSISTANT_DEFAULT_KEY,
  LET_ASSISTANT_ESCALATED_KEY,
  ROOT_LOCATION,
  createStep,
  findStepById,
  graphToTree,
  initialGraphDraft,
  insertStepAt,
  newTree,
  stepPaths,
  treeToGraph,
  type TreeStep,
  type WorkflowGraphJson,
  type WorkflowTree,
} from '../../workflow-graph'
import { WORKFLOW_TEMPLATES } from '../../workflow-templates'
import { describeBranchPath } from '../step-content'
import {
  collectForks,
  forkLaneKeys,
  lanesRevealingNode,
  walkStepList,
  type StepListInput,
} from '../tree-walk'

function baseInput(tree: WorkflowTree, overrides: Partial<StepListInput> = {}): StepListInput {
  return {
    tree,
    triggerLabel: 'New conversation',
    triggerChannels: [],
    labels: {},
    stepIssues: new Map(),
    selectedId: null,
    ...overrides,
  }
}

function canonicalizeGraph(graph: WorkflowGraphJson): WorkflowGraphJson {
  const nodes = [...graph.nodes]
    .map((node) => JSON.parse(JSON.stringify(node)) as WorkflowGraphJson['nodes'][number])
    .sort((a, b) => a.id.localeCompare(b.id))
  const edges = [...graph.edges]
    .map((edge) => JSON.parse(JSON.stringify(edge)) as WorkflowGraphJson['edges'][number])
    .sort((a, b) => {
      const from = a.from.localeCompare(b.from)
      if (from !== 0) return from
      const to = a.to.localeCompare(b.to)
      if (to !== 0) return to
      return (a.branch ?? '').localeCompare(b.branch ?? '')
    })
  return { nodes, edges }
}

describe('walkStepList — no fork', () => {
  it('walks the trigger and a trailing add for an empty tree', () => {
    const tree = newTree()
    const doc = walkStepList(baseInput(tree))
    expect(doc.trigger).toMatchObject({
      title: 'New conversation',
      icon: 'trigger',
      tone: 'amber',
      startTag: true,
      deletable: false,
    })
    expect(doc.items).toEqual([{ type: 'add', insertion: { location: ROOT_LOCATION, index: 0 } }])
  })

  it('shows an End marker instead of Add when the trunk ends by closing', () => {
    let tree = newTree()
    const close: TreeStep = { id: 'close-1', kind: 'action', action: { type: 'close' } }
    tree = insertStepAt(tree, ROOT_LOCATION, 0, close)

    const doc = walkStepList(baseInput(tree))
    expect(doc.items.map((item) => item.type)).toEqual(['step', 'end'])
    const step = doc.items[0]
    expect(step).toMatchObject({
      type: 'step',
      id: 'close-1',
      data: { tone: 'blue', meta: 'Ends the workflow' },
    })
  })

  it('flags an unresolved issue and marks the selected node', () => {
    let tree = newTree()
    const assign: TreeStep = {
      id: 'act-1',
      kind: 'action',
      action: { type: 'assign_team', teamId: '' },
    }
    tree = insertStepAt(tree, ROOT_LOCATION, 0, assign)

    const doc = walkStepList(
      baseInput(tree, {
        stepIssues: new Map([['act-1', 'Choose a team to assign']]),
        selectedId: 'act-1',
      })
    )
    expect(doc.items[0]).toMatchObject({
      type: 'step',
      data: {
        warn: true,
        selected: true,
        chips: [{ label: 'Choose a team…' }],
      },
    })
  })

  it('renders trigger channel chips, or an "All channels" fallback', () => {
    const tree = newTree()
    const withChannels = walkStepList(baseInput(tree, { triggerChannels: ['email', 'messenger'] }))
    expect(withChannels.trigger.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'Email' }, { label: 'Messenger' }] },
      { label: 'Frequency cap', chips: [{ label: 'No limit' }] },
    ])

    const withoutChannels = walkStepList(baseInput(tree))
    expect(withoutChannels.trigger.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'All channels' }] },
      { label: 'Frequency cap', chips: [{ label: 'No limit' }] },
    ])
  })

  it('renders the trigger frequency cap section, or "No limit" when unset', () => {
    const tree = newTree()
    const capped = walkStepList(
      baseInput(tree, { triggerFrequencyCap: { type: 'n_total', count: 3 } })
    )
    expect(capped.trigger.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'All channels' }] },
      { label: 'Frequency cap', chips: [{ label: 'At most 3 times per person' }] },
    ])

    const unlimited = walkStepList(baseInput(tree, { triggerFrequencyCap: { type: 'unlimited' } }))
    expect(unlimited.trigger.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'All channels' }] },
      { label: 'Frequency cap', chips: [{ label: 'No limit' }] },
    ])
  })

  it('omits the Audience/Send window sections entirely when unconfigured', () => {
    const tree = newTree()
    expect(walkStepList(baseInput(tree)).trigger.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'All channels' }] },
      { label: 'Frequency cap', chips: [{ label: 'No limit' }] },
    ])

    const emptyAudience = walkStepList(baseInput(tree, { triggerAudience: {} }))
    expect(emptyAudience.trigger.sections).toHaveLength(2)

    const anyWindow = walkStepList(baseInput(tree, { triggerSendWindow: 'any' }))
    expect(anyWindow.trigger.sections).toHaveLength(2)
  })

  it('surfaces an Audience section, with a nested-group-aware summary, once configured', () => {
    const tree = newTree()
    const doc = walkStepList(
      baseInput(tree, {
        triggerAudience: { field: 'conversation.priority', op: 'eq', value: 'high' },
      })
    )
    expect(doc.trigger.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'All channels' }] },
      { label: 'Frequency cap', chips: [{ label: 'No limit' }] },
      { label: 'Audience', chips: [{ label: 'Priority is High' }] },
    ])

    const grouped = walkStepList(
      baseInput(tree, {
        triggerAudience: {
          any: [
            { all: [{ field: 'conversation.priority', op: 'eq', value: 'high' }] },
            { all: [{ field: 'conversation.status', op: 'eq', value: 'open' }] },
          ],
        },
      })
    )
    expect(grouped.trigger.sections).toContainEqual({
      label: 'Audience',
      chips: [{ label: 'Any of 2 groups matched' }],
    })
  })

  it('surfaces a Send window section once configured, but not for "any"', () => {
    const tree = newTree()
    const inside = walkStepList(baseInput(tree, { triggerSendWindow: 'inside_office_hours' }))
    expect(inside.trigger.sections).toContainEqual({
      label: 'Send window',
      chips: [{ label: 'Only inside office hours' }],
    })

    const outside = walkStepList(baseInput(tree, { triggerSendWindow: 'outside_office_hours' }))
    expect(outside.trigger.sections).toContainEqual({
      label: 'Send window',
      chips: [{ label: 'Only outside office hours' }],
    })
  })

  it('renders a relative snooze action chip as "For N units", legacy as before', () => {
    let tree = newTree()
    tree = {
      ...tree,
      steps: [{ id: 'a1', kind: 'action', action: { type: 'snooze', seconds: 7200 } }],
    }
    const doc = walkStepList(baseInput(tree))
    expect(doc.items[0]).toMatchObject({
      type: 'step',
      data: { chips: [{ label: 'For 2 hours' }] },
    })

    let legacyTree = newTree()
    legacyTree = {
      ...legacyTree,
      steps: [{ id: 'a1', kind: 'action', action: { type: 'snooze', untilIso: null } }],
    }
    const legacy = walkStepList(baseInput(legacyTree))
    expect(legacy.items[0]).toMatchObject({
      type: 'step',
      data: { chips: [{ label: 'Until they reply' }] },
    })
  })

  it('renders Let Quinn answer as a Step with the engine-default 10-min escalate chip', () => {
    let tree = newTree()
    const step = createStep(tree, 'let_assistant_answer')
    tree = insertStepAt(tree, ROOT_LOCATION, 0, step)
    const item = walkStepList(baseInput(tree)).items[0]
    expect(item).toMatchObject({
      type: 'fork',
      data: {
        eyebrow: 'Step',
        title: 'Let Quinn answer',
        chips: [
          { label: "Escalates after 10 min if Quinn can't reply", tone: 'amber', wrap: true },
        ],
      },
    })
  })

  it('phrases the escalate chip from assistantEscalateMinutes when provided', () => {
    let tree = newTree()
    const step = createStep(tree, 'let_assistant_answer')
    tree = insertStepAt(tree, ROOT_LOCATION, 0, step)
    const item = walkStepList(baseInput(tree, { assistantEscalateMinutes: 5 })).items[0]
    expect(item).toMatchObject({
      type: 'fork',
      data: { chips: [{ label: "Escalates after 5 min if Quinn can't reply" }] },
    })
  })
})

describe('walkStepList — fork', () => {
  function branchFixture() {
    let tree = newTree()
    const branch = createStep(tree, 'branch') as Extract<TreeStep, { kind: 'branch' }>
    tree = insertStepAt(tree, ROOT_LOCATION, 0, branch)
    const [pathA, pathB] = branch.paths as [
      { key: string; condition: object; steps: TreeStep[] },
      { key: string; condition: object; steps: TreeStep[] },
    ]
    const locA = { path: [{ branchId: branch.id, pathKey: pathA.key }] }
    const wait: TreeStep = { id: 'wait-1', kind: 'wait', seconds: 3600 }
    tree = insertStepAt(tree, locA, 0, wait)
    return { tree, branch, pathA, pathB }
  }

  it('places the branch card in the trunk and enumerates every outgoing path key', () => {
    const { tree, branch, pathA, pathB } = branchFixture()
    const doc = walkStepList(baseInput(tree))
    const fork = doc.items[0]
    expect(fork).toMatchObject({
      type: 'fork',
      id: branch.id,
      data: {
        eyebrow: 'Branch · first match',
        title: '2 paths',
        tone: 'violet',
        deletable: true,
        nestedCount: 1,
      },
    })
    expect(fork.type).toBe('fork')
    if (fork.type !== 'fork') return
    expect(forkLaneKeys(fork)).toEqual([pathA.key, pathB.key])
    expect(fork.lanes).toHaveLength(2)
    expect(fork.lanes[0]!.items.map((item) => item.type)).toEqual(['step', 'add'])
    expect(fork.lanes[1]!.items.map((item) => item.type)).toEqual(['add'])
  })

  it('does not add a trailing add/end after a trunk fork card', () => {
    const { tree } = branchFixture()
    const doc = walkStepList(baseInput(tree))
    expect(doc.items.map((item) => item.type)).toEqual(['fork'])
  })

  it('treats an empty request_csat as a linear step, not a fork', () => {
    let tree = newTree()
    const csat = createStep(tree, 'request_csat')
    tree = insertStepAt(tree, ROOT_LOCATION, 0, csat)
    const doc = walkStepList(baseInput(tree))
    expect(doc.items.map((item) => item.type)).toEqual(['step', 'add'])
    expect(doc.items[0]).toMatchObject({ type: 'step', id: csat.id })
  })

  it('keeps the tail after inserting an empty request_csat between two steps', () => {
    let tree = newTree()
    const wait: TreeStep = { id: 'wait-1', kind: 'wait', seconds: 60 }
    const close: TreeStep = { id: 'close-1', kind: 'action', action: { type: 'close' } }
    tree = insertStepAt(tree, ROOT_LOCATION, 0, wait)
    tree = insertStepAt(tree, ROOT_LOCATION, 1, close)
    const csat = createStep(tree, 'request_csat')
    tree = insertStepAt(tree, ROOT_LOCATION, 1, csat)

    const doc = walkStepList(baseInput(tree))
    expect(doc.items.map((item) => ('id' in item ? `${item.type}:${item.id}` : item.type))).toEqual(
      ['step:wait-1', `step:${csat.id}`, 'step:close-1', 'end']
    )

    const graph = treeToGraph(tree)
    const draft = initialGraphDraft(graph)
    expect(draft.mode).toBe('visual')
  })

  it('enumerates let_assistant_answer lanes from the graph keys', () => {
    let tree = newTree()
    const step = createStep(tree, 'let_assistant_answer')
    tree = insertStepAt(tree, ROOT_LOCATION, 0, step)
    const doc = walkStepList(baseInput(tree))
    const fork = doc.items[0]
    expect(fork?.type).toBe('fork')
    if (fork?.type !== 'fork') return
    expect(forkLaneKeys(fork)).toEqual([LET_ASSISTANT_DEFAULT_KEY, LET_ASSISTANT_ESCALATED_KEY])
    expect(stepPaths(step)?.map((p) => p.key)).toEqual(forkLaneKeys(fork))
    expect(fork.lanes.map((lane) => lane.label)).toEqual(['Continues', 'If escalated to a human'])
  })

  it('enumerates reply_buttons lanes from the option keys', () => {
    let tree = newTree()
    const step = createStep(tree, 'reply_buttons') as Extract<TreeStep, { kind: 'reply_buttons' }>
    tree = insertStepAt(tree, ROOT_LOCATION, 0, step)
    const doc = walkStepList(baseInput(tree))
    const fork = doc.items[0]
    expect(fork?.type).toBe('fork')
    if (fork?.type !== 'fork') return
    expect(forkLaneKeys(fork)).toEqual(step.paths.map((p) => p.key))
  })
})

describe('lanesRevealingNode', () => {
  it('reveals the lane that contains the selected node', () => {
    let tree = newTree()
    const branch = createStep(tree, 'branch') as Extract<TreeStep, { kind: 'branch' }>
    tree = insertStepAt(tree, ROOT_LOCATION, 0, branch)
    const pathA = branch.paths[0]!
    const locA = { path: [{ branchId: branch.id, pathKey: pathA.key }] }
    const wait: TreeStep = { id: 'wait-1', kind: 'wait', seconds: 3600 }
    tree = insertStepAt(tree, locA, 0, wait)

    const doc = walkStepList(baseInput(tree))
    expect(lanesRevealingNode(doc.items, 'wait-1')).toEqual({ [branch.id]: pathA.key })
    expect(lanesRevealingNode(doc.items, branch.id)).toEqual({ [branch.id]: pathA.key })
  })
})

describe('gallery templates', () => {
  const walkable = WORKFLOW_TEMPLATES.map((template) => ({
    template,
    tree: graphToTree(template.payload.graph),
  })).filter((entry) => entry.tree.ok)

  it('every template graphToTree accepts must walk', () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(12)
    expect(walkable).toHaveLength(WORKFLOW_TEMPLATES.length)
    for (const { template, tree } of walkable) {
      if (!tree.ok) continue
      const doc = walkStepList(baseInput(tree.value))
      expect(doc.trigger.stepId, template.id).toBe(tree.value.triggerId)
      expect(doc.items.length, template.id).toBeGreaterThan(0)
    }
  })

  it('treeToGraph of a walked tree has zero graph diff after canonicalize', () => {
    for (const { template, tree } of walkable) {
      if (!tree.ok) continue
      walkStepList(baseInput(tree.value))
      expect(canonicalizeGraph(treeToGraph(tree.value)), template.id).toEqual(
        canonicalizeGraph(template.payload.graph)
      )
    }
  })

  it('lane tabs enumerate every outgoing branch key of each fork', () => {
    for (const { template, tree } of walkable) {
      if (!tree.ok) continue
      const doc = walkStepList(baseInput(tree.value))
      for (const fork of collectForks(doc.items)) {
        const found = findStepById(tree.value, fork.id)
        expect(found, `${template.id}:${fork.id}`).toBeTruthy()
        expect(forkLaneKeys(fork), `${template.id}:${fork.id}`).toEqual(
          (stepPaths(found!.step) ?? []).map((path) => path.key)
        )
      }
    }
  })

  it('wired request_csat in the AI-first template enumerates rating keys from the graph', () => {
    const template = WORKFLOW_TEMPLATES.find((entry) => entry.id === 'ai-first-support')
    expect(template).toBeTruthy()
    const graph = template!.payload.graph
    const csat = graph.nodes.find((node) => node.type === 'request_csat')
    expect(csat).toBeTruthy()
    const ratingKeys = graph.edges
      .filter((edge) => edge.from === csat!.id && edge.branch !== undefined)
      .map((edge) => edge.branch as string)
    expect(ratingKeys.length).toBeGreaterThan(0)

    const tree = graphToTree(graph)
    expect(tree.ok).toBe(true)
    if (!tree.ok) return
    const fork = collectForks(walkStepList(baseInput(tree.value)).items).find(
      (item) => item.id === csat!.id
    )
    expect(fork).toBeTruthy()
    expect(forkLaneKeys(fork!)).toEqual(ratingKeys)
  })
})

describe('describeBranchPath', () => {
  it('describes an empty condition as matching everything', () => {
    expect(describeBranchPath({})).toEqual([{ text: 'No conditions · matches everything' }])
  })

  it('bolds the field and value for a single simple rule', () => {
    const parts = describeBranchPath({ field: 'office_hours', op: 'eq', value: true })
    expect(parts).toEqual([
      { text: 'If ' },
      { text: 'Within office hours', bold: true },
      { text: ' is ' },
      { text: 'yes', bold: true },
    ])
  })

  it('falls back to the plain summary for a multi-rule condition', () => {
    const parts = describeBranchPath({
      all: [
        { field: 'message.body', op: 'contains', value: 'billing' },
        { field: 'conversation.priority', op: 'eq', value: 'high' },
      ],
    })
    expect(parts).toEqual([{ text: 'Message body contains billing +1 more' }])
  })

  it('describes an OR-of-groups condition via conditionSummary, not "Custom condition"', () => {
    const parts = describeBranchPath({
      any: [
        { all: [{ field: 'conversation.priority', op: 'eq', value: 'high' }] },
        { all: [{ field: 'conversation.status', op: 'eq', value: 'open' }] },
      ],
    })
    expect(parts).toEqual([{ text: 'Any of 2 groups matched' }])
  })

  it('still falls back to "Custom condition" for a shape RuleGroupBuilder cannot represent either', () => {
    const parts = describeBranchPath({
      all: [{ any: [{ field: 'conversation.status', op: 'eq', value: 'open' }] }],
    })
    expect(parts).toEqual([{ text: 'Custom condition' }])
  })
})
