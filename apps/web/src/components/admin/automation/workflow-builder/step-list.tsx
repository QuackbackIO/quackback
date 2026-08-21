/**
 * Vertical step list for the workflow builder: a document of cards, one
 * lane visible at a fork, the rest behind tabs.
 */
import { useEffect, useLayoutEffect, useMemo, useState, type ComponentType } from 'react'
import { useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import {
  BoltIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
  PlusIcon,
  ShareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { MENU_LABEL } from '@/components/ui/menu'
import { settingsQueries } from '@/lib/client/queries/settings'
import { assistantWaitMinutes } from '@/lib/shared/workflows/abandoned-auto-close'
import { useWorkflowEntities } from './entities'
import { ACTION_ICONS, BLOCK_ICONS, ConfirmDeleteDialog, TONE_TILE } from './step-visuals'
import { LaneTabs } from './lane-tabs'
import {
  lanesRevealingNode,
  walkStepList,
  type ForkLane,
  type Insertion,
  type StepListItem,
} from './tree-walk'
import type { ChipData, IconKey, StepNodeData } from './step-content'
import type { BuilderSelection } from './types'
import type {
  FrequencyCap,
  GraphCondition,
  SendWindow,
  StepLocation,
  WorkflowTree,
} from '../workflow-graph'

const ICONS: Record<IconKey, ComponentType<{ className?: string }>> = {
  trigger: BoltIcon,
  condition: FunnelIcon,
  branch: ShareIcon,
  wait: ClockIcon,
  ...ACTION_ICONS,
  ...BLOCK_ICONS,
}

function Chip({ chip }: { chip: ChipData }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 text-xs font-medium',
        chip.wrap
          ? 'h-auto min-h-[22px] max-w-full whitespace-normal py-0.5 text-left'
          : 'h-[22px] whitespace-nowrap',
        chip.tone ? TONE_TILE[chip.tone] : 'bg-muted text-muted-foreground'
      )}
    >
      {chip.label}
    </span>
  )
}

function sameInsertion(a: Insertion, b: Insertion): boolean {
  if (a.index !== b.index || a.location.path.length !== b.location.path.length) return false
  return a.location.path.every(
    (hop, i) =>
      hop.branchId === b.location.path[i]?.branchId && hop.pathKey === b.location.path[i]?.pathKey
  )
}

function PlusConnector({
  insertion,
  selected,
  onInsert,
  label,
}: {
  insertion: Insertion
  selected: boolean
  onInsert: (location: StepLocation, index: number) => void
  label: string
}) {
  return (
    <div className="flex flex-col items-center">
      <span className="h-3 w-px bg-border" />
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => onInsert(insertion.location, insertion.index)}
        className={cn(
          'flex size-[22px] items-center justify-center rounded-full border-[1.5px] bg-card text-muted-foreground shadow-xs transition-colors hover:border-primary/60 hover:text-foreground',
          selected ? 'border-ring text-foreground ring-2 ring-ring' : 'border-border'
        )}
      >
        <PlusIcon className="size-2.5" />
      </button>
      <span className="h-3 w-px bg-border" />
    </div>
  )
}

function LineConnector() {
  return <div className="h-6 w-px bg-border" />
}

function StepCard({
  data,
  startLabel,
  deleteTitle,
  deleteDescription,
  onSelect,
  onRemove,
}: {
  data: StepNodeData
  startLabel: string
  deleteTitle: string
  deleteDescription: string
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const Icon = ICONS[data.icon]

  return (
    <div className="group relative w-full max-w-[300px]">
      <button
        type="button"
        data-step-id={data.stepId}
        onClick={() => onSelect(data.stepId)}
        className={cn(
          'relative w-full cursor-pointer rounded-xl border bg-card text-left shadow-xs transition-shadow',
          data.selected
            ? 'border-transparent shadow-md ring-2 ring-ring'
            : data.warn
              ? 'border-amber-500/60'
              : 'border-border hover:border-foreground/25'
        )}
      >
        {data.startTag && (
          <span className="absolute -top-[21px] left-3.5 rounded-t-md bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-amber-700 uppercase dark:text-amber-400">
            {startLabel}
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
            <div className={MENU_LABEL}>{data.eyebrow}</div>
            <div className="mt-0.5 truncate text-sm font-semibold">{data.title}</div>
          </div>
        </div>
        {(data.sections?.length || data.chips?.length || data.meta) && (
          <div className="flex flex-col gap-2 border-t border-border/50 px-3 py-2.5">
            {data.sections ? (
              data.sections.map((section) => (
                <div key={section.label} className="flex flex-col gap-1">
                  <span className={MENU_LABEL}>{section.label}</span>
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
                {data.meta && <span className="text-[11px]">{data.meta}</span>}
              </div>
            )}
          </div>
        )}
      </button>

      {data.deletable && (
        <button
          type="button"
          aria-label={`Delete ${data.eyebrow.toLowerCase()} step`}
          onClick={() => (data.nestedCount ? setConfirmOpen(true) : onRemove(data.stepId))}
          className="pointer-events-none absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-xs transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 hover:text-destructive focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <XMarkIcon className="size-3" />
        </button>
      )}
      {!!data.nestedCount && (
        <ConfirmDeleteDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={deleteTitle}
          description={deleteDescription}
          onConfirm={() => onRemove(data.stepId)}
        />
      )}
    </div>
  )
}

function StepListItems({
  items,
  laneKeys,
  onChangeLane,
  selection,
  addStepLabel,
  endLabel,
  startLabel,
  deleteTitle,
  deleteDescription,
  onSelect,
  onInsert,
  onRemove,
}: {
  items: StepListItem[]
  laneKeys: Record<string, string>
  onChangeLane: (forkId: string, key: string) => void
  selection: BuilderSelection
  addStepLabel: string
  endLabel: string
  startLabel: string
  deleteTitle: string
  deleteDescription: (count: number) => string
  onSelect: (id: string) => void
  onInsert: (location: StepLocation, index: number) => void
  onRemove: (id: string) => void
}) {
  const insertSelected = (insertion: Insertion) =>
    selection?.kind === 'insert' &&
    sameInsertion(insertion, { location: selection.location, index: selection.index })

  return (
    <>
      {items.map((item, i) => {
        if (item.type === 'step') {
          return (
            <div key={item.id} className="flex w-full flex-col items-center">
              <PlusConnector
                insertion={item.insertionBefore}
                selected={insertSelected(item.insertionBefore)}
                onInsert={onInsert}
                label={addStepLabel}
              />
              <StepCard
                data={item.data}
                startLabel={startLabel}
                deleteTitle={deleteTitle}
                deleteDescription={deleteDescription(item.data.nestedCount ?? 0)}
                onSelect={onSelect}
                onRemove={onRemove}
              />
            </div>
          )
        }
        if (item.type === 'fork') {
          const activeKey = laneKeys[item.id] ?? item.lanes[0]?.key ?? ''
          const lane: ForkLane | undefined = item.lanes.find((l) => l.key === activeKey)
          return (
            <div key={item.id} className="flex w-full flex-col items-center">
              <PlusConnector
                insertion={item.insertionBefore}
                selected={insertSelected(item.insertionBefore)}
                onInsert={onInsert}
                label={addStepLabel}
              />
              <StepCard
                data={item.data}
                startLabel={startLabel}
                deleteTitle={deleteTitle}
                deleteDescription={deleteDescription(item.data.nestedCount ?? 0)}
                onSelect={onSelect}
                onRemove={onRemove}
              />
              {item.lanes.length > 0 && (
                <>
                  <LineConnector />
                  <LaneTabs
                    lanes={item.lanes}
                    activeKey={activeKey}
                    onChange={(key) => onChangeLane(item.id, key)}
                  />
                  <LineConnector />
                  {lane && (
                    <StepListItems
                      items={lane.items}
                      laneKeys={laneKeys}
                      onChangeLane={onChangeLane}
                      selection={selection}
                      addStepLabel={addStepLabel}
                      endLabel={endLabel}
                      startLabel={startLabel}
                      deleteTitle={deleteTitle}
                      deleteDescription={deleteDescription}
                      onSelect={onSelect}
                      onInsert={onInsert}
                      onRemove={onRemove}
                    />
                  )}
                </>
              )}
            </div>
          )
        }
        if (item.type === 'add') {
          return (
            <div key={`add-${i}`} className="flex w-full max-w-[300px] flex-col items-center">
              <LineConnector />
              <button
                type="button"
                aria-label={addStepLabel}
                onClick={() => onInsert(item.insertion.location, item.insertion.index)}
                className={cn(
                  'flex w-full items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground',
                  insertSelected(item.insertion)
                    ? 'border-ring text-foreground ring-2 ring-ring'
                    : 'border-border'
                )}
              >
                <PlusIcon className="size-3.5" /> {addStepLabel}
              </button>
            </div>
          )
        }
        return (
          <div key={`end-${i}`} className="flex flex-col items-center">
            <LineConnector />
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <span className="size-2 rounded-full bg-border" /> {endLabel}
            </span>
          </div>
        )
      })}
    </>
  )
}

export function StepList({
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
  triggerChannels: string[]
  triggerFrequencyCap?: FrequencyCap
  triggerAudience?: GraphCondition
  triggerSendWindow?: SendWindow
  selection: BuilderSelection
  stepIssues: ReadonlyMap<string, string>
  onSelectNode: (id: string) => void
  onSelectInsertion: (location: StepLocation, index: number) => void
  onRemoveStep: (id: string) => void
}) {
  const intl = useIntl()
  const { labels } = useWorkflowEntities()
  const autoClose = useQuery(settingsQueries.workflowAbandonedAutoClose())
  const assistantEscalateMinutes = assistantWaitMinutes(autoClose.data)
  const selectedId = selection?.kind === 'node' ? selection.id : null

  const startLabel = intl.formatMessage({
    id: 'automation.builder.start',
    defaultMessage: 'Start',
  })
  const addStepLabel = intl.formatMessage({
    id: 'automation.builder.addStep',
    defaultMessage: 'Add step',
  })
  const endLabel = intl.formatMessage({
    id: 'automation.builder.end',
    defaultMessage: 'End',
  })
  const deleteTitle = intl.formatMessage({
    id: 'automation.builder.deleteFork.title',
    defaultMessage: 'Delete this step?',
  })
  const deleteDescription = (count: number) =>
    intl.formatMessage(
      {
        id: 'automation.builder.deleteFork.description',
        defaultMessage:
          'Its paths and their {count, plural, one {# step} other {# steps}} will be removed.',
      },
      { count }
    )

  const stepDoc = useMemo(
    () =>
      walkStepList({
        tree,
        triggerLabel,
        triggerChannels,
        triggerFrequencyCap,
        triggerAudience,
        triggerSendWindow,
        labels,
        stepIssues,
        selectedId,
        assistantEscalateMinutes,
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
      selectedId,
      assistantEscalateMinutes,
    ]
  )

  const [laneKeys, setLaneKeys] = useState<Record<string, string>>({})

  useLayoutEffect(() => {
    if (!selectedId) return
    const reveal = lanesRevealingNode(stepDoc.items, selectedId)
    if (Object.keys(reveal).length === 0) return
    setLaneKeys((prev) => ({ ...prev, ...reveal }))
  }, [selectedId, stepDoc.items])

  useEffect(() => {
    if (!selectedId) return
    const el = globalThis.document.querySelector(`[data-step-id="${CSS.escape(selectedId)}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId, laneKeys, stepDoc.items])

  return (
    <div
      role="region"
      aria-label="Workflow steps"
      className="flex min-h-0 flex-1 justify-center overflow-y-auto bg-background"
    >
      <div className="flex w-full max-w-xl flex-col items-center px-4 pt-10 pb-16">
        <StepCard
          data={stepDoc.trigger}
          startLabel={startLabel}
          deleteTitle={deleteTitle}
          deleteDescription={deleteDescription(0)}
          onSelect={onSelectNode}
          onRemove={onRemoveStep}
        />
        <StepListItems
          items={stepDoc.items}
          laneKeys={laneKeys}
          onChangeLane={(forkId, key) => setLaneKeys((prev) => ({ ...prev, [forkId]: key }))}
          selection={selection}
          addStepLabel={addStepLabel}
          endLabel={endLabel}
          startLabel={startLabel}
          deleteTitle={deleteTitle}
          deleteDescription={deleteDescription}
          onSelect={onSelectNode}
          onInsert={onSelectInsertion}
          onRemove={onRemoveStep}
        />
      </div>
    </div>
  )
}
