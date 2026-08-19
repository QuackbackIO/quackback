/**
 * Pure logic added for the fullscreen workflow builder: step addressing
 * (locate/insert/update/remove by id across branch paths), per-step issue
 * collection, the top bar's overall issue summary, and outline derivation.
 */
import { describe, expect, it } from 'vitest'
import {
  ROOT_LOCATION,
  actionIssue,
  collectStepIssues,
  createStep,
  deriveOutline,
  describeInsertionContext,
  draftIssues,
  findStepById,
  insertStepAt,
  newTree,
  removeStepById,
  stepsAtLocation,
  updateStepById,
  type StepLocation,
  type TreeStep,
  type WorkflowTree,
} from '../workflow-graph'

/** trigger -> condition-1 -> branch-1 { Path 1: [action-1 (bad)], Path 2: [wait-1, action-2 (ok)] } */
function fixtureTree(): WorkflowTree {
  let tree = newTree()
  const condition = createStep(tree, 'condition')
  tree = { ...tree, steps: [condition] }

  const branch = createStep(tree, 'branch') as Extract<TreeStep, { kind: 'branch' }>
  tree = insertStepAt(tree, ROOT_LOCATION, 1, branch)

  const pathOneLoc: StepLocation = {
    path: [{ branchId: branch.id, pathKey: branch.paths[0]!.key }],
  }
  const pathTwoLoc: StepLocation = {
    path: [{ branchId: branch.id, pathKey: branch.paths[1]!.key }],
  }

  const badAction: TreeStep = {
    id: 'action-1',
    kind: 'action',
    action: { type: 'assign_team', teamId: '' },
  }
  tree = insertStepAt(tree, pathOneLoc, 0, badAction)

  const wait: TreeStep = { id: 'wait-1', kind: 'wait', seconds: 3600 }
  tree = insertStepAt(tree, pathTwoLoc, 0, wait)
  const okAction: TreeStep = {
    id: 'action-2',
    kind: 'action',
    action: { type: 'set_priority', priority: 'high' },
  }
  tree = insertStepAt(tree, pathTwoLoc, 1, okAction)

  return tree
}

describe('step addressing', () => {
  it('locates a nested step by id with the location needed to update it', () => {
    const tree = fixtureTree()
    const found = findStepById(tree, 'wait-1')
    expect(found).not.toBeNull()
    expect(found?.location.path).toHaveLength(1)
    expect(stepsAtLocation(tree, found!.location).map((s) => s.id)).toContain('wait-1')
  })

  it('returns null for an id that is not in the tree', () => {
    expect(findStepById(fixtureTree(), 'nope')).toBeNull()
  })

  it('updates a deeply nested step without disturbing its siblings', () => {
    const tree = fixtureTree()
    const next = updateStepById(tree, 'wait-1', (s) =>
      s.kind === 'wait' ? { ...s, seconds: 60 } : s
    )
    const wait = findStepById(next, 'wait-1')?.step
    expect(wait).toMatchObject({ kind: 'wait', seconds: 60 })
    // The sibling in the same path is untouched.
    expect(findStepById(next, 'action-2')?.step).toMatchObject({
      action: { type: 'set_priority', priority: 'high' },
    })
  })

  it('is a no-op when updating/removing an id that does not exist', () => {
    const tree = fixtureTree()
    expect(updateStepById(tree, 'nope', (s) => s)).toEqual(tree)
    expect(removeStepById(tree, 'nope')).toEqual(tree)
  })

  it('removes a step from within a branch path', () => {
    const tree = fixtureTree()
    const next = removeStepById(tree, 'wait-1')
    expect(findStepById(next, 'wait-1')).toBeNull()
    // action-2 (wait-1's sibling) survives the removal.
    expect(findStepById(next, 'action-2')).not.toBeNull()
  })

  it('inserts at a branch path location at the given index', () => {
    const tree = fixtureTree()
    const branch = tree.steps[1] as Extract<TreeStep, { kind: 'branch' }>
    const loc: StepLocation = { path: [{ branchId: branch.id, pathKey: branch.paths[1]!.key }] }
    const step = createStep(tree, 'wait')
    const next = insertStepAt(tree, loc, 0, step)
    expect(stepsAtLocation(next, loc)[0]?.id).toBe(step.id)
  })
})

describe('actionIssue / collectStepIssues', () => {
  it('flags an action missing its required field', () => {
    expect(actionIssue({ type: 'assign_team', teamId: '' })).toBe('Choose a team to assign')
    expect(actionIssue({ type: 'assign_team', teamId: 't_1' })).toBeNull()
    expect(actionIssue({ type: 'apply_sla', policyId: '' })).not.toBeNull()
    expect(actionIssue({ type: 'close' })).toBeNull()
  })

  it('collects issues across all branch paths, keyed by step id', () => {
    const issues = collectStepIssues(fixtureTree())
    expect(issues.get('action-1')).toBe('Choose a team to assign')
    expect(issues.has('action-2')).toBe(false)
    expect(issues.size).toBe(1)
  })
})

describe('draftIssues', () => {
  it('summarizes visual-mode issues from the tree', () => {
    const result = draftIssues({ mode: 'visual', tree: fixtureTree() })
    expect(result.blocking).toBeNull()
    expect(result.count).toBe(1)
    expect(result.firstId).toBe('action-1')
    expect(result.ids.has('action-1')).toBe(true)
  })

  it('reports a blocking error for invalid JSON text', () => {
    const result = draftIssues({ mode: 'json', text: '{ not json' })
    expect(result.blocking).toBeTruthy()
    expect(result.count).toBe(1)
  })

  it('is clean for valid JSON text with no per-node concept', () => {
    const result = draftIssues({
      mode: 'json',
      text: JSON.stringify({ nodes: [{ id: 'trigger', type: 'trigger' }], edges: [] }),
    })
    expect(result.blocking).toBeNull()
    expect(result.count).toBe(0)
  })
})

describe('deriveOutline', () => {
  it('lists the trigger, then steps, with a header row per branch path', () => {
    const tree = fixtureTree()
    const issues = collectStepIssues(tree)
    const outline = deriveOutline(tree, 'New conversation', issues, {})

    expect(outline[0]).toMatchObject({ kind: 'trigger', label: 'New conversation', depth: 0 })
    expect(outline.map((e) => e.kind)).toEqual([
      'trigger',
      'condition',
      'branch',
      'path-header',
      'action',
      'path-header',
      'wait',
      'action',
    ])

    const badRow = outline.find((e) => e.kind !== 'path-header' && 'id' in e && e.id === 'action-1')
    expect(badRow).toMatchObject({ hasIssue: true })
    const okRow = outline.find((e) => e.kind !== 'path-header' && 'id' in e && e.id === 'action-2')
    expect(okRow).toMatchObject({ hasIssue: false })

    const pathHeaders = outline.filter((e) => e.kind === 'path-header')
    expect(pathHeaders.map((e) => e.label)).toEqual(['Path A · Path 1', 'Path B · Path 2'])
    // Steps inside a path are indented one level deeper than the branch itself.
    const branchDepth = outline.find((e) => e.kind === 'branch')?.depth
    expect(pathHeaders[0]?.depth).toBe((branchDepth ?? 0) + 1)
  })
})

describe('describeInsertionContext', () => {
  it('describes a trunk insertion generically (before/append)', () => {
    const tree = fixtureTree()
    expect(describeInsertionContext(tree, ROOT_LOCATION, 0)).toBe('Inserts into the workflow')
    const trunkLength = stepsAtLocation(tree, ROOT_LOCATION).length
    expect(describeInsertionContext(tree, ROOT_LOCATION, trunkLength)).toBe(
      'Appends to the workflow'
    )
  })

  it('names the path by letter and key for a branch path insertion', () => {
    const tree = fixtureTree()
    const branch = tree.steps[1] as Extract<TreeStep, { kind: 'branch' }>
    const pathOneLoc: StepLocation = {
      path: [{ branchId: branch.id, pathKey: branch.paths[0]!.key }],
    }
    const pathTwoLoc: StepLocation = {
      path: [{ branchId: branch.id, pathKey: branch.paths[1]!.key }],
    }

    expect(describeInsertionContext(tree, pathOneLoc, 0)).toBe(
      `Inserts in path A · ${branch.paths[0]!.key}`
    )
    const pathTwoLength = stepsAtLocation(tree, pathTwoLoc).length
    expect(describeInsertionContext(tree, pathTwoLoc, pathTwoLength)).toBe(
      `Appends to path B · ${branch.paths[1]!.key}`
    )
  })
})
