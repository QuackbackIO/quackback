/**
 * The fullscreen builder's canvas (support platform §4.6), rebuilt on
 * React Flow (@xyflow/react) to match the approved design: an auto-layout
 * tree — trigger at top, a linear trunk down to (and including) a branch
 * step, each branch path fanned into its own column below a violet "rule"
 * pill — rendered as draggable-for-elbow-room cards whose positions are
 * fully derived from the graph (see ./flow-layout.ts) and recomputed
 * wholesale on every tree/selection/issue change. Clicking a card selects it
 * (the inspector shows its editor); the circular "+" on an edge, and the
 * dashed "Add step" tail on a path, both open the step palette at that
 * insertion point instead of a dropdown.
 */
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react'
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './canvas.css'
import {
  BoltIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
  MapIcon,
  MoonIcon,
  PlusIcon,
  ShareIcon,
  XMarkIcon,
  AdjustmentsHorizontalIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  FlagIcon,
  ShieldCheckIcon,
  TagIcon,
  TicketIcon,
  UserGroupIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { useWorkflowEntities } from './entities'
import { BLOCK_ICONS, CALL_CONNECTOR_ICON, ConfirmDeleteDialog, TONE_TILE } from './step-visuals'
import type { BuilderSelection } from './types'
import type {
  FrequencyCap,
  GraphCondition,
  SendWindow,
  StepLocation,
  WorkflowTree,
} from '../workflow-graph'
import {
  buildFlowEdges,
  buildFlowNodes,
  type AddNodeData,
  type ChipData,
  type EndNodeData,
  type FlowLayoutInput,
  type IconKey,
  type RuleNodeData,
  type StepNodeData,
} from './flow-layout'

// ---------------------------------------------------------------------------
// Tone + icon lookup (canvas-only: per-tone tiles/chips, distinct from the
// inspector's flat GATE_TINT/STEP_TINT in step-visuals.tsx)
// ---------------------------------------------------------------------------

const ICONS: Record<IconKey, ComponentType<{ className?: string }>> = {
  trigger: BoltIcon,
  condition: FunnelIcon,
  branch: ShareIcon,
  wait: ClockIcon,
  assign_agent: UserPlusIcon,
  assign_team: UserGroupIcon,
  add_tag: TagIcon,
  remove_tag: TagIcon,
  set_priority: FlagIcon,
  snooze: MoonIcon,
  close: CheckCircleIcon,
  reopen: ArrowUturnLeftIcon,
  apply_sla: ShieldCheckIcon,
  set_attribute: AdjustmentsHorizontalIcon,
  add_note: DocumentTextIcon,
  set_ticket_status: TicketIcon,
  convert_to_ticket: TicketIcon,
  call_connector: CALL_CONNECTOR_ICON,
  ...BLOCK_ICONS,
}

const TONE_CHIP = TONE_TILE

const HIDDEN_HANDLE = {
  opacity: 0,
  width: 6,
  height: 6,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
  pointerEvents: 'none' as const,
}

function Chip({ chip }: { chip: ChipData }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center rounded-md px-2 text-xs font-medium whitespace-nowrap',
        chip.tone ? TONE_CHIP[chip.tone] : 'bg-muted text-muted-foreground'
      )}
    >
      {chip.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Canvas-wide actions, provided via context so custom node/edge renderers
// (which only receive `id`/`data` from React Flow) can reach the builder's
// select/insert/remove callbacks without threading them through node data.
// ---------------------------------------------------------------------------

interface CanvasActions {
  onSelect: (id: string) => void
  onInsert: (location: StepLocation, index: number) => void
  onRemove: (id: string) => void
}

const CanvasActionsContext = createContext<CanvasActions | null>(null)

function useCanvasActions(): CanvasActions {
  const ctx = useContext(CanvasActionsContext)
  if (!ctx) throw new Error('Canvas node/edge rendered outside WorkflowBuilderCanvas')
  return ctx
}

// ---------------------------------------------------------------------------
// Node renderers
// ---------------------------------------------------------------------------

const StepNode = memo(function StepNode({ data }: NodeProps<Node<StepNodeData, 'step'>>) {
  const actions = useCanvasActions()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const Icon = ICONS[data.icon]

  return (
    <div className="group relative">
      <button
        type="button"
        data-step-id={data.stepId}
        onClick={() => actions.onSelect(data.stepId)}
        className={cn(
          'relative w-[300px] cursor-pointer rounded-xl border bg-card text-left shadow-xs transition-shadow',
          data.selected
            ? 'border-transparent shadow-md ring-2 ring-ring'
            : data.warn
              ? 'border-amber-500/60'
              : 'border-border hover:border-foreground/25'
        )}
      >
        {data.startTag && (
          <span className="absolute -top-[21px] left-3.5 rounded-t-md bg-amber-500/15 px-2.5 py-0.5 text-[10.5px] font-bold tracking-wide text-amber-700 uppercase dark:text-amber-400">
            Start
          </span>
        )}
        {data.warn && (
          <ExclamationTriangleIcon className="absolute top-2.5 right-2.5 size-3.5 text-amber-600 dark:text-amber-500" />
        )}
        <div className="flex items-center gap-2.5 p-3">
          <span
            className={cn(
              'flex size-[30px] shrink-0 items-center justify-center rounded-lg',
              TONE_TILE[data.tone]
            )}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">
              {data.eyebrow}
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold">{data.title}</div>
          </div>
        </div>
        {(data.sections?.length || data.chips?.length || data.meta) && (
          <div className="flex flex-col gap-2 border-t border-border/50 px-3 py-2.5">
            {data.sections ? (
              data.sections.map((section) => (
                <div key={section.label} className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">
                    {section.label}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {section.chips.map((chip, i) => (
                      <Chip key={i} chip={chip} />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {data.chips?.map((chip, i) => (
                  <Chip key={i} chip={chip} />
                ))}
                {data.meta && <span className="text-[11.5px]">{data.meta}</span>}
              </div>
            )}
          </div>
        )}
        <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} isConnectable={false} />
        <Handle
          type="source"
          position={Position.Bottom}
          style={HIDDEN_HANDLE}
          isConnectable={false}
        />
      </button>

      {data.deletable && (
        <button
          type="button"
          aria-label={`Delete ${data.eyebrow.toLowerCase()} step`}
          onClick={() => (data.nestedCount ? setConfirmOpen(true) : actions.onRemove(data.stepId))}
          className="pointer-events-none absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-xs transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 hover:text-destructive focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <XMarkIcon className="size-3" />
        </button>
      )}
      {!!data.nestedCount && (
        <ConfirmDeleteDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Delete this branch?"
          description={`Its paths and their ${data.nestedCount} step${data.nestedCount === 1 ? '' : 's'} will be removed.`}
          onConfirm={() => actions.onRemove(data.stepId)}
        />
      )}
    </div>
  )
})

const RuleNode = memo(function RuleNode({ data }: NodeProps<Node<RuleNodeData, 'rule'>>) {
  return (
    <div className="relative w-[300px]">
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
        <span className="flex size-5 items-center justify-center rounded-md bg-violet-500/10 text-[11px] font-bold text-violet-700 dark:text-violet-300">
          {data.badge}
        </span>
        {data.name}
      </div>
      <div className="rounded-[10px] border border-dashed border-violet-500/40 bg-violet-500/10 px-3 py-2 text-center text-[12.5px] text-violet-700 dark:text-violet-300">
        {data.parts.map((part, i) =>
          part.bold ? (
            <b key={i} className="font-bold">
              {part.text}
            </b>
          ) : (
            <span key={i}>{part.text}</span>
          )
        )}
      </div>
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} isConnectable={false} />
      <Handle
        type="source"
        position={Position.Bottom}
        style={HIDDEN_HANDLE}
        isConnectable={false}
      />
    </div>
  )
})

const AddNode = memo(function AddNode({ data }: NodeProps<Node<AddNodeData, 'add'>>) {
  const actions = useCanvasActions()
  return (
    <div className="relative w-[300px]">
      <button
        type="button"
        aria-label="Add step"
        onClick={() => actions.onInsert(data.insertion.location, data.insertion.index)}
        className="flex w-full items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed border-border py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
      >
        <PlusIcon className="size-3.5" /> Add step
      </button>
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} isConnectable={false} />
    </div>
  )
})

const EndNode = memo(function EndNode(_props: NodeProps<Node<EndNodeData, 'end'>>) {
  return (
    <div className="relative flex w-[300px] items-center justify-center">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <span className="size-2 rounded-full bg-border" /> End
      </span>
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE} isConnectable={false} />
    </div>
  )
})

// ---------------------------------------------------------------------------
// Edge renderer: smoothstep wire with a circular "+" at the midpoint that
// opens the palette at that insertion point (absent for the branch -> rule
// edges, which have no insertion point of their own).
// ---------------------------------------------------------------------------

const PlusEdge = memo(function PlusEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<Edge<{ insertion?: { location: StepLocation; index: number } }, 'plus'>>) {
  const actions = useCanvasActions()
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
  })
  const insertion = data?.insertion

  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: 'var(--wf-wire)', strokeWidth: 1.5 }} />
      {insertion && (
        <EdgeLabelRenderer>
          <button
            type="button"
            title="Add step"
            aria-label="Add step"
            onClick={() => actions.onInsert(insertion.location, insertion.index)}
            className="qbwf-edge-plus nodrag nopan absolute flex size-[22px] items-center justify-center rounded-full border-[1.5px] border-border bg-card text-muted-foreground shadow-xs transition-colors"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            <PlusIcon className="size-2.5" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

const NODE_TYPES: NodeTypes = { step: StepNode, rule: RuleNode, add: AddNode, end: EndNode }
const EDGE_TYPES: EdgeTypes = { plus: PlusEdge }

// ---------------------------------------------------------------------------
// Canvas body (inside the ReactFlowProvider so it can use useReactFlow)
// ---------------------------------------------------------------------------

function CanvasInner({
  layoutInput,
  selection,
  showMinimap,
}: {
  layoutInput: FlowLayoutInput
  selection: BuilderSelection
  showMinimap: boolean
}) {
  const { fitView, setCenter, getZoom } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState(buildFlowNodes(layoutInput))
  const edges = useMemo(() => buildFlowEdges(layoutInput), [layoutInput])

  // Positions are fully derived from the tree: every layout-relevant change
  // (tree edits, selection, issues) replaces the node array wholesale. A
  // node dragged for elbow room keeps that position only until the next
  // recompute, same as the design reference.
  useEffect(() => {
    setNodes(buildFlowNodes(layoutInput))
  }, [layoutInput, setNodes])

  // Keep a freshly selected node in view, mirroring the old canvas's
  // scrollIntoView-on-select (used by the outline rail, the issues chip, and
  // newly inserted steps).
  useEffect(() => {
    if (selection?.kind !== 'node') return
    const node = nodes.find((n) => n.id === selection.id)
    if (!node) return
    const width = 300
    const height = 88
    setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: Math.max(getZoom(), 0.6),
      duration: 300,
    })
    // Only re-center when the selected id changes, not on every layout tick
    // (nodes/setCenter/getZoom are stable enough not to need re-running for).
  }, [selection?.kind === 'node' ? selection.id : null])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onInit={() => fitView({ padding: 0.12, maxZoom: 0.95 })}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 0.95 }}
      minZoom={0.25}
      maxZoom={1.75}
      nodesConnectable={false}
      panOnScroll
      zoomOnScroll={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="var(--wf-dot)" />
      <Controls showInteractive={false} position="bottom-left" />
      {showMinimap && (
        <MiniMap
          pannable
          position="bottom-right"
          nodeColor={(n) => (n.type === 'rule' ? 'oklch(0.55 0.15 295 / .5)' : 'var(--muted)')}
          maskColor="color-mix(in oklab, var(--background) 75%, transparent)"
          style={{ background: 'var(--card)' }}
        />
      )}
    </ReactFlow>
  )
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function WorkflowBuilderCanvas({
  tree,
  triggerLabel,
  triggerChannels,
  triggerFrequencyCap,
  triggerAudience,
  triggerSendWindow,
  selection,
  stepIssues,
  onSelectNode,
  onSelectInsertion,
  onRemoveStep,
}: {
  tree: WorkflowTree
  triggerLabel: string
  /** Channel keys from the trigger settings draft, for the trigger card's
   *  "Channels" section. */
  triggerChannels: string[]
  /** The trigger's per-person run cap, for the trigger card's "Frequency
   *  cap" section. */
  triggerFrequencyCap?: FrequencyCap
  /** The trigger's audience condition, for the trigger card's "Audience"
   *  section — omitted entirely (no chip) when unconfigured. */
  triggerAudience?: GraphCondition
  /** The trigger's office-hours restriction, for the trigger card's "Send
   *  window" section — omitted entirely (no chip) when 'any'/unset. */
  triggerSendWindow?: SendWindow
  selection: BuilderSelection
  stepIssues: ReadonlyMap<string, string>
  onSelectNode: (id: string) => void
  onSelectInsertion: (location: StepLocation, index: number) => void
  onRemoveStep: (id: string) => void
}) {
  const { labels } = useWorkflowEntities()
  const [showMinimap, setShowMinimap] = useState(true)

  const layoutInput = useMemo<FlowLayoutInput>(
    () => ({
      tree,
      triggerLabel,
      triggerChannels,
      triggerFrequencyCap,
      triggerAudience,
      triggerSendWindow,
      labels,
      stepIssues,
      selectedId: selection?.kind === 'node' ? selection.id : null,
    }),
    [
      tree,
      triggerLabel,
      triggerChannels,
      triggerFrequencyCap,
      triggerAudience,
      triggerSendWindow,
      labels,
      stepIssues,
      selection,
    ]
  )

  const actions = useMemo<CanvasActions>(
    () => ({ onSelect: onSelectNode, onInsert: onSelectInsertion, onRemove: onRemoveStep }),
    [onSelectNode, onSelectInsertion, onRemoveStep]
  )

  return (
    <div className="qbwf-canvas relative flex-1 bg-muted/20">
      <CanvasActionsContext.Provider value={actions}>
        <ReactFlowProvider>
          <CanvasInner layoutInput={layoutInput} selection={selection} showMinimap={showMinimap} />
        </ReactFlowProvider>
      </CanvasActionsContext.Provider>

      <button
        type="button"
        onClick={() => setShowMinimap((v) => !v)}
        aria-label={showMinimap ? 'Hide minimap' : 'Show minimap'}
        aria-pressed={showMinimap}
        className={cn(
          'absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-xs transition-colors hover:text-foreground',
          showMinimap && 'text-foreground'
        )}
      >
        <MapIcon className="size-4" />
      </button>
    </div>
  )
}
