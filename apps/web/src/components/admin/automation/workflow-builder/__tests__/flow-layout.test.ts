/**
 * Pure layout coverage for the React Flow canvas rebuild: the recursive
 * column-width measurement, node/edge generation for a plain trunk and for
 * a branch (including a nested branch inside a path), insertion indices on
 * the "+" edges, and the rule-pill condition summary.
 */
import { describe, expect, it } from 'vitest'
import {
  ROOT_LOCATION,
  createStep,
  insertStepAt,
  newTree,
  type StepLocation,
  type TreeStep,
  type WorkflowTree,
} from '../../workflow-graph'
import {
  addNodeId,
  buildFlowEdges,
  buildFlowNodes,
  describeBranchPath,
  endNodeId,
  laneWidth,
  ruleNodeId,
  type FlowLayoutInput,
} from '../flow-layout'

function baseInput(tree: WorkflowTree, overrides: Partial<FlowLayoutInput> = {}): FlowLayoutInput {
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

describe('laneWidth', () => {
  it('is 1 for a linear lane, including an empty one', () => {
    expect(laneWidth([])).toBe(1)
    const wait: TreeStep = { id: 'wait-1', kind: 'wait', seconds: 60 }
    expect(laneWidth([wait])).toBe(1)
  })

  it('sums each path width when the lane ends in a branch', () => {
    const branch = createStep(newTree(), 'branch') as Extract<TreeStep, { kind: 'branch' }>
    expect(branch.paths).toHaveLength(2)
    expect(laneWidth([branch])).toBe(2) // two paths, each width 1
  })

  it('recurses into a nested branch inside a path', () => {
    let tree = newTree()
    const outer = createStep(tree, 'branch') as Extract<TreeStep, { kind: 'branch' }>
    tree = { ...tree, steps: [outer] }
    const pathOneLoc: StepLocation = {
      path: [{ branchId: outer.id, pathKey: outer.paths[0]!.key }],
    }
    const inner = createStep(tree, 'branch') as Extract<TreeStep, { kind: 'branch' }>
    tree = insertStepAt(tree, pathOneLoc, 0, inner)
    const rebuiltOuter = tree.steps[0] as Extract<TreeStep, { kind: 'branch' }>
    // Path 1 now itself ends in a 2-path branch (width 2); Path 2 is empty (width 1).
    expect(laneWidth([rebuiltOuter])).toBe(3)
  })
})

describe('buildFlowNodes / buildFlowEdges — no branch', () => {
  it('lays out the trigger and a trailing add node for an empty tree', () => {
    const tree = newTree()
    const nodes = buildFlowNodes(baseInput(tree))
    const edges = buildFlowEdges(baseInput(tree))

    const trigger = nodes.find((n) => n.id === tree.triggerId)
    expect(trigger).toMatchObject({
      type: 'step',
      position: { x: 0, y: 22 },
      data: {
        title: 'New conversation',
        icon: 'trigger',
        tone: 'amber',
        startTag: true,
        deletable: false,
      },
    })

    const addId = addNodeId(ROOT_LOCATION)
    const addNode = nodes.find((n) => n.id === addId)
    expect(addNode).toMatchObject({
      type: 'add',
      data: { insertion: { location: ROOT_LOCATION, index: 0 } },
    })

    const edge = edges.find((e) => e.source === tree.triggerId && e.target === addId)
    expect(edge).toMatchObject({ type: 'plus', data: { insertion: { index: 0 } } })
  })

  it('shows an End marker instead of Add when the trunk ends by closing', () => {
    let tree = newTree()
    const close: TreeStep = { id: 'close-1', kind: 'action', action: { type: 'close' } }
    tree = insertStepAt(tree, ROOT_LOCATION, 0, close)

    const nodes = buildFlowNodes(baseInput(tree))
    const endId = endNodeId(ROOT_LOCATION)
    expect(nodes.find((n) => n.id === endId)).toMatchObject({ type: 'end' })
    expect(nodes.find((n) => n.id === addNodeId(ROOT_LOCATION))).toBeUndefined()

    const closeNode = nodes.find((n) => n.id === 'close-1')
    expect(closeNode).toMatchObject({ data: { tone: 'blue', meta: 'Ends the workflow' } })
  })

  it('flags an unresolved issue and marks the selected node', () => {
    let tree = newTree()
    const assign: TreeStep = {
      id: 'act-1',
      kind: 'action',
      action: { type: 'assign_team', teamId: '' },
    }
    tree = insertStepAt(tree, ROOT_LOCATION, 0, assign)

    const nodes = buildFlowNodes(
      baseInput(tree, {
        stepIssues: new Map([['act-1', 'Choose a team to assign']]),
        selectedId: 'act-1',
      })
    )
    const node = nodes.find((n) => n.id === 'act-1')
    expect(node).toMatchObject({
      data: {
        warn: true,
        selected: true,
        chips: [{ label: 'Choose a team…' }],
      },
    })
  })

  it('renders trigger channel chips, or an "All channels" fallback', () => {
    const tree = newTree()
    const withChannels = buildFlowNodes(
      baseInput(tree, { triggerChannels: ['email', 'messenger'] })
    )
    const trigger = withChannels.find((n) => n.id === tree.triggerId)
    expect(trigger?.data.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'Email' }, { label: 'Messenger' }] },
      { label: 'Frequency cap', chips: [{ label: 'No limit' }] },
    ])

    const withoutChannels = buildFlowNodes(baseInput(tree))
    expect(withoutChannels.find((n) => n.id === tree.triggerId)?.data.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'All channels' }] },
      { label: 'Frequency cap', chips: [{ label: 'No limit' }] },
    ])
  })

  it('renders the trigger frequency cap section, or "No limit" when unset', () => {
    const tree = newTree()
    const capped = buildFlowNodes(
      baseInput(tree, { triggerFrequencyCap: { type: 'n_total', count: 3 } })
    )
    expect(capped.find((n) => n.id === tree.triggerId)?.data.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'All channels' }] },
      { label: 'Frequency cap', chips: [{ label: 'At most 3 times per person' }] },
    ])

    const unlimited = buildFlowNodes(
      baseInput(tree, { triggerFrequencyCap: { type: 'unlimited' } })
    )
    expect(unlimited.find((n) => n.id === tree.triggerId)?.data.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'All channels' }] },
      { label: 'Frequency cap', chips: [{ label: 'No limit' }] },
    ])
  })

  it('omits the Audience/Send window sections entirely when unconfigured (the common case stays a 2-section card)', () => {
    const tree = newTree()
    const nodes = buildFlowNodes(baseInput(tree))
    expect(nodes.find((n) => n.id === tree.triggerId)?.data.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'All channels' }] },
      { label: 'Frequency cap', chips: [{ label: 'No limit' }] },
    ])

    // An explicitly-empty audience ({}) is the same as unconfigured (the
    // trigger editor drops the key on write) — no chip either.
    const emptyAudience = buildFlowNodes(baseInput(tree, { triggerAudience: {} }))
    expect(emptyAudience.find((n) => n.id === tree.triggerId)?.data.sections).toHaveLength(2)

    // 'any' is the unconfigured sendWindow value too — no chip.
    const anyWindow = buildFlowNodes(baseInput(tree, { triggerSendWindow: 'any' }))
    expect(anyWindow.find((n) => n.id === tree.triggerId)?.data.sections).toHaveLength(2)
  })

  it('surfaces an Audience section, with a nested-group-aware summary, once configured', () => {
    const tree = newTree()
    const nodes = buildFlowNodes(
      baseInput(tree, {
        triggerAudience: { field: 'conversation.priority', op: 'eq', value: 'high' },
      })
    )
    expect(nodes.find((n) => n.id === tree.triggerId)?.data.sections).toEqual([
      { label: 'Channels', chips: [{ label: 'All channels' }] },
      { label: 'Frequency cap', chips: [{ label: 'No limit' }] },
      { label: 'Audience', chips: [{ label: 'Priority is High' }] },
    ])

    const grouped = buildFlowNodes(
      baseInput(tree, {
        triggerAudience: {
          any: [
            { all: [{ field: 'conversation.priority', op: 'eq', value: 'high' }] },
            { all: [{ field: 'conversation.status', op: 'eq', value: 'open' }] },
          ],
        },
      })
    )
    expect(grouped.find((n) => n.id === tree.triggerId)?.data.sections).toContainEqual({
      label: 'Audience',
      chips: [{ label: 'Any of 2 groups matched' }],
    })
  })

  it('surfaces a Send window section once configured, but not for "any"', () => {
    const tree = newTree()
    const inside = buildFlowNodes(baseInput(tree, { triggerSendWindow: 'inside_office_hours' }))
    expect(inside.find((n) => n.id === tree.triggerId)?.data.sections).toContainEqual({
      label: 'Send window',
      chips: [{ label: 'Only inside office hours' }],
    })

    const outside = buildFlowNodes(baseInput(tree, { triggerSendWindow: 'outside_office_hours' }))
    expect(outside.find((n) => n.id === tree.triggerId)?.data.sections).toContainEqual({
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
    const nodes = buildFlowNodes(baseInput(tree))
    const step = nodes.find((n) => n.id === 'a1')
    expect(step?.data).toMatchObject({ chips: [{ label: 'For 2 hours' }] })

    let legacyTree = newTree()
    legacyTree = {
      ...legacyTree,
      steps: [{ id: 'a1', kind: 'action', action: { type: 'snooze', untilIso: null } }],
    }
    const legacyNodes = buildFlowNodes(baseInput(legacyTree))
    expect(legacyNodes.find((n) => n.id === 'a1')?.data).toMatchObject({
      chips: [{ label: 'Until they reply' }],
    })
  })
})

describe('buildFlowNodes / buildFlowEdges — branch', () => {
  function branchFixture() {
    let tree = newTree()
    const branch = createStep(tree, 'branch') as Extract<TreeStep, { kind: 'branch' }>
    tree = insertStepAt(tree, ROOT_LOCATION, 0, branch)
    const [pathA, pathB] = branch.paths as [
      { key: string; condition: object; steps: TreeStep[] },
      { key: string; condition: object; steps: TreeStep[] },
    ]
    const locA: StepLocation = { path: [{ branchId: branch.id, pathKey: pathA.key }] }
    const locB: StepLocation = { path: [{ branchId: branch.id, pathKey: pathB.key }] }
    const wait: TreeStep = { id: 'wait-1', kind: 'wait', seconds: 3600 }
    tree = insertStepAt(tree, locA, 0, wait)
    return { tree, branch, locA, locB }
  }

  it('places a rule pill above each path and the branch card in the trunk', () => {
    const { tree, branch, locA, locB } = branchFixture()
    const nodes = buildFlowNodes(baseInput(tree))

    const branchNode = nodes.find((n) => n.id === branch.id)
    expect(branchNode).toMatchObject({
      type: 'step',
      data: {
        eyebrow: 'Branch · first match',
        title: '2 paths',
        tone: 'violet',
        deletable: true,
        nestedCount: 1, // the one wait step in path A
      },
    })

    const ruleA = nodes.find((n) => n.id === ruleNodeId(locA))
    expect(ruleA).toMatchObject({ type: 'rule', data: { badge: 'A' } })
    const ruleB = nodes.find((n) => n.id === ruleNodeId(locB))
    expect(ruleB).toMatchObject({ type: 'rule', data: { badge: 'B' } })

    // Path A (with a step) and path B (empty) sit in different columns.
    expect(ruleA!.position.x).not.toBe(ruleB!.position.x)

    // Path A has its wait step then an Add tail; empty path B goes straight to Add.
    expect(nodes.find((n) => n.id === 'wait-1')).toMatchObject({
      position: { x: ruleA!.position.x },
    })
    expect(nodes.find((n) => n.id === addNodeId(locA))).toBeTruthy()
    expect(nodes.find((n) => n.id === addNodeId(locB))).toBeTruthy()
  })

  it('gives the branch -> rule edge no insertion point, unlike step edges', () => {
    const { tree, branch, locA } = branchFixture()
    const edges = buildFlowEdges(baseInput(tree))
    const branchToRule = edges.find((e) => e.source === branch.id && e.target === ruleNodeId(locA))
    expect(branchToRule?.data.insertion).toBeUndefined()

    const ruleToWait = edges.find((e) => e.source === ruleNodeId(locA) && e.target === 'wait-1')
    expect(ruleToWait?.data.insertion).toEqual({ location: locA, index: 0 })
  })

  it('does not add a trailing connector after the trunk branch card', () => {
    const { tree, branch } = branchFixture()
    const edges = buildFlowEdges(baseInput(tree))
    // No edge should originate from the branch card except the two rule edges.
    const fromBranch = edges.filter((e) => e.source === branch.id)
    expect(fromBranch).toHaveLength(2)
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
