/**
 * Pure graph -> React Flow layout for the fullscreen workflow builder canvas
 * (support platform §4.6). Mirrors the auto-layout algorithm from the
 * approved design's reference implementation (flow-canvas.js): a linear
 * trunk from the trigger down to (and including) a branch step, with each
 * branch path fanned out as its own column below a "rule" pill node.
 * Workflows without a branch render as a single centered column.
 *
 * Generalizes the reference (which only handles one level of branching) to
 * our tree model's actual invariant: any lane (the trunk, or a branch path)
 * may itself end in a nested branch, recursively. Column widths are measured
 * bottom-up so a lane with a wide subtree gets proportionally more horizontal
 * room, and every lane's own steps stay centered above its children.
 *
 * No React/RF imports here on purpose: canvas.tsx feeds this output straight
 * into ReactFlow's `nodes`/`edges` props, but every function below is a plain
 * data transform, exercised directly by flow-layout.test.ts.
 */
import {
  ACTION_LABELS,
  durationPhrase,
  frequencyCapSummary,
  OPERATOR_LABELS,
  PATH_LETTERS,
  PRIORITY_LABELS,
  TRIGGER_CHANNELS,
  VALUELESS_OPERATORS,
  conditionSummary,
  conditionToDraft,
  countSteps,
  isNeedsSetupRef,
  resolveConditionField,
  waitSummary,
  type ActionType,
  type AttributeFieldDef,
  type EntityLabels,
  type FrequencyCap,
  type GraphAction,
  type GraphCondition,
  type StepLocation,
  type TreeStep,
  type WorkflowTree,
} from '../workflow-graph'

// ---------------------------------------------------------------------------
// Layout constants (pixel values, matching the design's reference layout)
// ---------------------------------------------------------------------------

export const COLW = 300
export const GAPX = 70
export const EDGE_GAP = 44
const RULE_GAP = 8
const RULE_H = 96
// The trigger card is the only node with more than one section (Channels,
// Frequency cap) — bumped from the single-section height (172) by roughly one
// more section row (label + chips + the inter-section gap) so the auto-layout
// doesn't crowd the card below it.
const NODE_H_SECTIONS = 216
const NODE_H_PLAIN = 88

// ---------------------------------------------------------------------------
// Node / edge data shapes. Structurally compatible with @xyflow/react's
// `Node<Data, Type>` / `Edge<Data>` so canvas.tsx can hand these arrays
// straight to <ReactFlow nodes=.../edges=.../>.
// ---------------------------------------------------------------------------

export type Tone = 'amber' | 'violet' | 'green' | 'blue'

/** Icon lookup key: the trigger, a step kind, or (for actions) the action type. */
export type IconKey = 'trigger' | 'condition' | 'branch' | 'wait' | ActionType

export interface ChipData {
  label: string
  tone?: Tone
}

export interface StepSectionData {
  label: string
  chips: ChipData[]
}

export interface StepNodeData extends Record<string, unknown> {
  stepId: string
  eyebrow: string
  title: string
  icon: IconKey
  tone: Tone
  chips?: ChipData[]
  meta?: string
  sections?: StepSectionData[]
  startTag?: boolean
  warn: boolean
  selected: boolean
  /** False only for the trigger — every other step card can be removed. */
  deletable: boolean
  /** Branch cards only: steps nested in its paths, for the "delete this
   *  branch?" confirmation copy. */
  nestedCount?: number
}

export interface RulePart {
  text: string
  bold?: boolean
}

export interface RuleNodeData extends Record<string, unknown> {
  badge: string
  name: string
  parts: RulePart[]
}

export interface AddNodeData extends Record<string, unknown> {
  insertion: { location: StepLocation; index: number }
}

export type EndNodeData = Record<string, never>

export interface FlowPosition {
  x: number
  y: number
}

export interface FlowStepNode {
  id: string
  type: 'step'
  position: FlowPosition
  draggable: true
  data: StepNodeData
}
export interface FlowRuleNode {
  id: string
  type: 'rule'
  position: FlowPosition
  draggable: true
  data: RuleNodeData
}
export interface FlowAddNode {
  id: string
  type: 'add'
  position: FlowPosition
  draggable: false
  data: AddNodeData
}
export interface FlowEndNode {
  id: string
  type: 'end'
  position: FlowPosition
  draggable: false
  data: EndNodeData
}

export type FlowNode = FlowStepNode | FlowRuleNode | FlowAddNode | FlowEndNode

export interface FlowEdgeData extends Record<string, unknown> {
  insertion?: { location: StepLocation; index: number }
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  type: 'plus'
  data: FlowEdgeData
}

export interface FlowLayoutInput {
  tree: WorkflowTree
  /** Display label for the trigger step (from triggerLabel()). */
  triggerLabel: string
  /** Raw channel keys from the trigger settings draft. */
  triggerChannels: string[]
  /** The trigger's per-person run cap, from the trigger settings draft
   *  (undefined/'unlimited' both render as "No limit"). */
  triggerFrequencyCap?: FrequencyCap
  labels: EntityLabels
  stepIssues: ReadonlyMap<string, string>
  selectedId: string | null
}

// ---------------------------------------------------------------------------
// Column-width measurement (bottom-up) and pixel conversion
// ---------------------------------------------------------------------------

/** Number of COLW-wide columns a lane needs: 1, unless it ends in a branch,
 *  in which case it's the sum of its paths' widths (each at least 1). */
export function laneWidth(steps: TreeStep[]): number {
  const last = steps[steps.length - 1]
  if (last && last.kind === 'branch') {
    const total = last.paths.reduce((sum, p) => sum + laneWidth(p.steps), 0)
    return Math.max(1, total)
  }
  return 1
}

function spanWidthPx(span: number): number {
  return span * COLW + (span - 1) * GAPX
}

/** The centered x for a COLW-wide card within `span` contiguous columns
 *  starting at column `colStart`. */
function centeredX(colStart: number, span: number): number {
  return colStart * (COLW + GAPX) + (spanWidthPx(span) - COLW) / 2
}

// ---------------------------------------------------------------------------
// Node id helpers (stable across re-layouts as long as branch ids / path
// keys are stable, which the tree model guarantees).
// ---------------------------------------------------------------------------

function locationKey(location: StepLocation): string {
  return location.path.length === 0
    ? '$root'
    : location.path.map((hop) => `${hop.branchId}::${hop.pathKey}`).join('>>')
}

export function ruleNodeId(location: StepLocation): string {
  return `rule:${locationKey(location)}`
}
export function addNodeId(location: StepLocation): string {
  return `add:${locationKey(location)}`
}
export function endNodeId(location: StepLocation): string {
  return `end:${locationKey(location)}`
}

// ---------------------------------------------------------------------------
// Per-step card content (eyebrow/title/tone/chips/meta)
// ---------------------------------------------------------------------------

export const ACTION_TONE: Record<ActionType, Tone> = {
  assign_agent: 'green',
  assign_team: 'green',
  add_tag: 'green',
  remove_tag: 'green',
  set_priority: 'green',
  apply_sla: 'green',
  set_attribute: 'green',
  snooze: 'amber',
  close: 'blue',
}

/** Ref -> display name, tolerant of an unset or needs-setup-template ref. */
function named(
  id: string,
  lookup: ReadonlyMap<string, string> | undefined,
  missing: string
): string {
  if (!id || isNeedsSetupRef(id)) return missing
  return lookup?.get(id) ?? id
}

function actionChips(action: GraphAction, labels: EntityLabels): ChipData[] {
  switch (action.type) {
    case 'assign_agent':
      return [{ label: named(action.principalId, labels.members, 'Choose a teammate…') }]
    case 'assign_team':
      return [{ label: named(action.teamId, labels.teams, 'Choose a team…') }]
    case 'add_tag':
    case 'remove_tag':
      return [{ label: named(action.tagId, labels.tags, 'Choose a tag…') }]
    case 'set_priority':
      return [
        {
          label: PRIORITY_LABELS[action.priority],
          tone: action.priority === 'high' || action.priority === 'urgent' ? 'amber' : undefined,
        },
      ]
    case 'apply_sla':
      return [{ label: named(action.policyId, labels.slaPolicies, 'Choose an SLA policy…') }]
    case 'set_attribute':
      return [{ label: action.key || 'Choose an attribute…' }]
    case 'snooze':
      return [
        {
          label:
            'seconds' in action
              ? `For ${durationPhrase(action.seconds)}`
              : action.untilIso
                ? new Date(action.untilIso).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : 'Until they reply',
        },
      ]
    case 'close':
      return []
  }
}

function buildStepNodeData(
  step: TreeStep,
  ctx: Pick<FlowLayoutInput, 'labels' | 'stepIssues' | 'selectedId'>
): StepNodeData {
  const base = {
    stepId: step.id,
    warn: ctx.stepIssues.has(step.id),
    selected: ctx.selectedId === step.id,
    deletable: true,
  }
  switch (step.kind) {
    case 'condition':
      return {
        ...base,
        eyebrow: 'Condition',
        title: 'Continue if…',
        icon: 'condition',
        tone: 'violet',
        meta: conditionSummary(step.condition, ctx.labels.attributes, ctx.labels.teams),
      }
    case 'branch': {
      const n = step.paths.length
      return {
        ...base,
        eyebrow: 'Branch · first match',
        title: `${n} path${n === 1 ? '' : 's'}`,
        icon: 'branch',
        tone: 'violet',
        meta: `${n} path${n === 1 ? '' : 's'} · evaluated top to bottom`,
        nestedCount: step.paths.reduce((sum, p) => sum + countSteps(p.steps), 0),
      }
    }
    case 'wait':
      return {
        ...base,
        eyebrow: 'Wait',
        title: waitSummary(step.seconds),
        icon: 'wait',
        tone: 'amber',
      }
    case 'action':
      return {
        ...base,
        eyebrow: 'Action',
        title: ACTION_LABELS[step.action.type],
        icon: step.action.type,
        tone: ACTION_TONE[step.action.type],
        chips: actionChips(step.action, ctx.labels),
        meta: step.action.type === 'close' ? 'Ends the workflow' : undefined,
      }
  }
}

const TRIGGER_CHANNEL_LABELS = new Map(TRIGGER_CHANNELS.map((c) => [c.value, c.label]))

function triggerSections(
  channels: string[],
  frequencyCap: FrequencyCap | undefined
): StepSectionData[] {
  const channelChips: ChipData[] = channels.length
    ? channels.map((c) => ({ label: TRIGGER_CHANNEL_LABELS.get(c) ?? c }))
    : [{ label: 'All channels' }]
  return [
    { label: 'Channels', chips: channelChips },
    { label: 'Frequency cap', chips: [{ label: frequencyCapSummary(frequencyCap) }] },
  ]
}

/** Bold-highlighted rule-pill copy for one branch path's condition. */
export function describeBranchPath(
  condition: GraphCondition,
  attributes: ReadonlyMap<string, AttributeFieldDef> = new Map(),
  teams: ReadonlyMap<string, string> = new Map()
): RulePart[] {
  const draft = conditionToDraft(condition)
  if (draft.kind === 'advanced') return [{ text: 'Custom condition' }]
  if (draft.rules.length === 0) return [{ text: 'No conditions · matches everything' }]
  if (draft.rules.length > 1) return [{ text: conditionSummary(condition, attributes, teams) }]

  const rule = draft.rules[0]!
  const meta = resolveConditionField(rule.field, attributes, teams)
  const op = OPERATOR_LABELS[rule.op]
  if (VALUELESS_OPERATORS.has(rule.op)) {
    return [{ text: 'If ' }, { text: meta.label, bold: true }, { text: ` ${op}` }]
  }
  let value = rule.value
  if (meta.kind === 'choice') {
    value = meta.options?.find((o) => o.value === rule.value)?.label ?? rule.value
  } else if (meta.kind === 'boolean') {
    value = rule.value === 'true' ? 'yes' : 'no'
  } else if (meta.kind === 'list' && meta.options) {
    const ids = rule.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    value = ids.map((id) => meta.options!.find((o) => o.value === id)?.label ?? id).join(', ')
  }
  return [
    { text: 'If ' },
    { text: meta.label, bold: true },
    { text: ` ${op} ` },
    { text: value || '…', bold: true },
  ]
}

// ---------------------------------------------------------------------------
// Recursive layout
// ---------------------------------------------------------------------------

interface LayoutAccumulator {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

function pushEdge(
  acc: LayoutAccumulator,
  source: string,
  target: string,
  insertion?: { location: StepLocation; index: number }
): void {
  acc.edges.push({
    id: `e:${source}->${target}`,
    source,
    target,
    type: 'plus',
    data: { insertion },
  })
}

function emitLane(
  acc: LayoutAccumulator,
  input: FlowLayoutInput,
  steps: TreeStep[],
  colStart: number,
  span: number,
  y: number,
  location: StepLocation,
  parentId: string
): void {
  let prevId = parentId
  let cursorY = y

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    const x = centeredX(colStart, span)
    const stepNode: FlowStepNode = {
      id: step.id,
      type: 'step',
      position: { x, y: cursorY },
      draggable: true,
      data: buildStepNodeData(step, input),
    }
    acc.nodes.push(stepNode)
    pushEdge(acc, prevId, step.id, { location, index: i })
    prevId = step.id
    cursorY += NODE_H_PLAIN + EDGE_GAP

    if (step.kind === 'branch') {
      const widths = step.paths.map((p) => laneWidth(p.steps))
      let colCursor = colStart
      const ruleY = cursorY + RULE_GAP
      for (let pi = 0; pi < step.paths.length; pi++) {
        const path = step.paths[pi]!
        const pSpan = widths[pi]!
        const childLocation: StepLocation = {
          path: [...location.path, { branchId: step.id, pathKey: path.key }],
        }
        const ruleId = ruleNodeId(childLocation)
        const ruleNode: FlowRuleNode = {
          id: ruleId,
          type: 'rule',
          position: { x: centeredX(colCursor, pSpan), y: ruleY },
          draggable: true,
          data: {
            badge: PATH_LETTERS[pi] ?? String(pi + 1),
            name: path.key,
            parts: describeBranchPath(path.condition, input.labels.attributes, input.labels.teams),
          },
        }
        acc.nodes.push(ruleNode)
        pushEdge(acc, step.id, ruleId)
        emitLane(
          acc,
          input,
          path.steps,
          colCursor,
          pSpan,
          ruleY + RULE_H + EDGE_GAP,
          childLocation,
          ruleId
        )
        colCursor += pSpan
      }
      return // a branch is always the last step of its lane; no trailing tail
    }
  }

  // Lane ended without a branch (including an empty lane): a trailing
  // "Add step" node, or an "End" marker if the last step closes the
  // conversation.
  const last = steps[steps.length - 1]
  const closesHere = !!last && last.kind === 'action' && last.action.type === 'close'
  const tailX = centeredX(colStart, span)
  if (closesHere) {
    const id = endNodeId(location)
    const node: FlowEndNode = {
      id,
      type: 'end',
      position: { x: tailX, y: cursorY },
      draggable: false,
      data: {},
    }
    acc.nodes.push(node)
    pushEdge(acc, prevId, id)
  } else {
    const id = addNodeId(location)
    const node: FlowAddNode = {
      id,
      type: 'add',
      position: { x: tailX, y: cursorY },
      draggable: false,
      data: { insertion: { location, index: steps.length } },
    }
    acc.nodes.push(node)
    pushEdge(acc, prevId, id, { location, index: steps.length })
  }
}

function computeLayout(input: FlowLayoutInput): LayoutAccumulator {
  const acc: LayoutAccumulator = { nodes: [], edges: [] }
  const rootSpan = laneWidth(input.tree.steps)
  const triggerId = input.tree.triggerId
  acc.nodes.push({
    id: triggerId,
    type: 'step',
    position: { x: centeredX(0, rootSpan), y: 22 },
    draggable: true,
    data: {
      stepId: triggerId,
      eyebrow: 'Trigger',
      title: input.triggerLabel,
      icon: 'trigger',
      tone: 'amber',
      startTag: true,
      sections: triggerSections(input.triggerChannels, input.triggerFrequencyCap),
      warn: false,
      deletable: false,
      selected: input.selectedId === triggerId,
    },
  })
  emitLane(
    acc,
    input,
    input.tree.steps,
    0,
    rootSpan,
    22 + NODE_H_SECTIONS + EDGE_GAP,
    { path: [] },
    triggerId
  )
  return acc
}

/** React Flow nodes for the current tree: trigger, every step (recursing
 *  into nested branch paths), a rule pill per path, and a trailing
 *  add/end node per leaf lane. Positions are fully derived from the tree —
 *  callers should replace their node state wholesale on every tree change. */
export function buildFlowNodes(input: FlowLayoutInput): FlowNode[] {
  return computeLayout(input).nodes
}

/** React Flow edges for the current tree, each smoothstep edge carrying an
 *  `insertion` descriptor for the midpoint "+" button (absent only for the
 *  branch -> rule-pill edges, which have no insertion point of their own). */
export function buildFlowEdges(input: FlowLayoutInput): FlowEdge[] {
  return computeLayout(input).edges
}
