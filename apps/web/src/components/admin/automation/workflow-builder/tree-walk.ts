/**
 * Tree walk for the workflow step list: a trunk of cards, then one lane
 * per fork. A stored graph that is not a tree never reaches this module —
 * the builder opens those in JSON mode via initialGraphDraft.
 */
import {
  countSteps,
  stepPaths,
  type FrequencyCap,
  type GraphCondition,
  type SendWindow,
  type StepLocation,
  type TreeStep,
  type WorkflowTree,
} from '../workflow-graph'
import {
  buildStepNodeData,
  buildTriggerNodeData,
  fanPathLabel,
  type StepContentContext,
  type StepNodeData,
} from './step-content'

export interface Insertion {
  location: StepLocation
  index: number
}

export interface ForkLane {
  key: string
  label: string
  stepCount: number
  items: StepListItem[]
}

export type StepListItem =
  | { type: 'step'; id: string; data: StepNodeData; insertionBefore: Insertion }
  | { type: 'fork'; id: string; data: StepNodeData; insertionBefore: Insertion; lanes: ForkLane[] }
  | { type: 'add'; insertion: Insertion }
  | { type: 'end' }

export interface StepListDocument {
  trigger: StepNodeData
  items: StepListItem[]
}

export interface StepListInput extends StepContentContext {
  tree: WorkflowTree
  triggerLabel: string
  triggerChannels: string[]
  triggerFrequencyCap?: FrequencyCap
  triggerAudience?: GraphCondition
  triggerSendWindow?: SendWindow
}

function walkLane(
  steps: TreeStep[],
  location: StepLocation,
  ctx: StepContentContext
): StepListItem[] {
  const items: StepListItem[] = []
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    const insertionBefore: Insertion = { location, index: i }
    const data = buildStepNodeData(step, ctx)
    const fan = stepPaths(step)
    if (fan) {
      items.push({
        type: 'fork',
        id: step.id,
        data,
        insertionBefore,
        lanes: fan.map((path) => ({
          key: path.key,
          label: fanPathLabel(step, path, ctx),
          stepCount: countSteps(path.steps),
          items: walkLane(
            path.steps,
            { path: [...location.path, { branchId: step.id, pathKey: path.key }] },
            ctx
          ),
        })),
      })
      return items
    }
    items.push({ type: 'step', id: step.id, data, insertionBefore })
  }

  const last = steps[steps.length - 1]
  const closesHere = !!last && last.kind === 'action' && last.action.type === 'close'
  if (closesHere) items.push({ type: 'end' })
  else items.push({ type: 'add', insertion: { location, index: steps.length } })
  return items
}

/** Walk a tree into the vertical document the step list renders. */
export function walkStepList(input: StepListInput): StepListDocument {
  const ctx: StepContentContext = {
    labels: input.labels,
    stepIssues: input.stepIssues,
    selectedId: input.selectedId,
    assistantEscalateMinutes: input.assistantEscalateMinutes,
  }
  return {
    trigger: buildTriggerNodeData(
      input.tree.triggerId,
      input.triggerLabel,
      input.triggerChannels,
      input.triggerFrequencyCap,
      input.triggerAudience,
      input.triggerSendWindow,
      ctx
    ),
    items: walkLane(input.tree.steps, { path: [] }, ctx),
  }
}

/** Every outgoing branch key of a fork, in declaration order. */
export function forkLaneKeys(item: Extract<StepListItem, { type: 'fork' }>): string[] {
  return item.lanes.map((lane) => lane.key)
}

function itemsContain(items: StepListItem[], nodeId: string): boolean {
  for (const item of items) {
    if (item.type === 'step' && item.id === nodeId) return true
    if (item.type === 'fork') {
      if (item.id === nodeId) return true
      if (item.lanes.some((lane) => itemsContain(lane.items, nodeId))) return true
    }
  }
  return false
}

/** Active-lane map that reveals `nodeId` (fork id → path key). State only. */
export function lanesRevealingNode(items: StepListItem[], nodeId: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const item of items) {
    if (item.type !== 'fork') continue
    for (const lane of item.lanes) {
      if (item.id === nodeId || itemsContain(lane.items, nodeId)) {
        found[item.id] = lane.key
        Object.assign(found, lanesRevealingNode(lane.items, nodeId))
        break
      }
    }
  }
  return found
}

export function collectForks(items: StepListItem[]): Extract<StepListItem, { type: 'fork' }>[] {
  const forks: Extract<StepListItem, { type: 'fork' }>[] = []
  for (const item of items) {
    if (item.type !== 'fork') continue
    forks.push(item)
    for (const lane of item.lanes) forks.push(...collectForks(lane.items))
  }
  return forks
}
