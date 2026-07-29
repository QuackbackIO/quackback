/**
 * Workflows manager (AI & Automation, support platform §4.6). A grouped,
 * filterable directory: workflows are bucketed by trigger type (in catalogue
 * order), each row shows lifecycle + class + trailing-7-day run metrics, and
 * "New workflow" opens either the template gallery or a blank draft. Editing
 * happens on the fullscreen builder route; this component only lists,
 * filters, and manages lifecycle (status, delete). The metrics cell doubles
 * as the entry point into WorkflowRunsSheet, the per-run drill-down (runs
 * list + event timeline) — otherwise a failing workflow is invisible beyond
 * these aggregate counts.
 */
import { useMemo, useState, type ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Bars3Icon } from '@heroicons/react/24/solid'
import {
  ArrowPathIcon,
  BoltIcon,
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  ClockIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  FireIcon,
  FlagIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  SparklesIcon,
  StarIcon,
  TagIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'
import { EllipsisVerticalIcon } from '@heroicons/react/24/solid'
import type { WorkflowDTO } from '@/lib/server/functions/workflows'
import { workflowsQuery } from '@/lib/client/queries/workflows'
import { workflowEffectivenessQuery } from '@/lib/client/queries/workflow-reporting'
import {
  useCreateWorkflow,
  useSetWorkflowStatus,
  useDeleteWorkflow,
  useReorderWorkflows,
} from '@/lib/client/mutations/workflows'
import {
  collectStepIssues,
  graphToTree,
  newTree,
  treeToGraph,
  validateGraph,
} from './workflow-graph'
import { WorkflowTemplateGallery } from './workflow-template-gallery'
import type { WorkflowTemplate } from './workflow-templates'
import { WorkflowRunsSheet } from './workflow-runs-sheet'
import { cn } from '@/lib/shared/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const CLASSES = [
  { value: 'customer_facing', label: 'Customer-facing' },
  { value: 'background', label: 'Background' },
] as const

interface TriggerMeta {
  value: string
  label: string
  icon: ComponentType<{ className?: string }>
  colorClass: string
}

/** Group order for the list: same order the builder's trigger picker uses. */
const TRIGGERS: TriggerMeta[] = [
  {
    value: 'conversation.created',
    label: 'New conversation',
    icon: BoltIcon,
    colorClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    value: 'message.created',
    label: 'Message received',
    icon: ChatBubbleLeftRightIcon,
    colorClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  {
    value: 'conversation.status_changed',
    label: 'Status changed',
    icon: ArrowPathIcon,
    colorClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
  {
    value: 'conversation.assigned',
    label: 'Assigned to team/agent',
    icon: UserGroupIcon,
    colorClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  {
    value: 'assistant.handed_off',
    label: 'AI agent handed off to a human',
    icon: SparklesIcon,
    colorClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  {
    value: 'conversation.priority_changed',
    label: 'Priority changed',
    icon: FlagIcon,
    colorClass: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  },
  {
    value: 'conversation.attribute_changed',
    label: 'Attribute changed',
    icon: TagIcon,
    colorClass: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  },
  {
    value: 'conversation.csat_submitted',
    label: 'CSAT rating submitted',
    icon: StarIcon,
    colorClass: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  },
  {
    value: 'message.note_created',
    label: 'Internal note added',
    icon: DocumentTextIcon,
    colorClass: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  },
  {
    value: 'conversation.customer_unresponsive',
    label: 'Customer stopped responding',
    icon: ClockIcon,
    colorClass: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  },
  {
    value: 'conversation.teammate_unresponsive',
    label: 'Teammate hasn’t responded',
    icon: ClockIcon,
    colorClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  },
  {
    value: 'sla.approaching_breach',
    label: 'SLA approaching breach',
    icon: ExclamationTriangleIcon,
    colorClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    value: 'sla.breached',
    label: 'SLA breached',
    icon: FireIcon,
    colorClass: 'bg-red-500/10 text-red-600 dark:text-red-400',
  },
]

const OTHER_TRIGGER_META: TriggerMeta = {
  value: 'other',
  label: 'Other triggers',
  icon: BoltIcon,
  colorClass: 'bg-muted text-muted-foreground',
}

const STATUSES = ['draft', 'live', 'paused'] as const
type StatusValue = (typeof STATUSES)[number]

const STATUS_META: Record<StatusValue, { label: string; dotClass: string; textClass: string }> = {
  live: {
    label: 'Live',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  paused: {
    label: 'Paused',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  draft: { label: 'Draft', dotClass: 'bg-muted-foreground', textClass: 'text-muted-foreground' },
}

const STATUS_ACTION_LABEL: Record<StatusValue, string> = {
  live: 'Set live',
  paused: 'Pause',
  draft: 'Mark as draft',
}

type EffectivenessMetrics = {
  started: number
  completed: number
  /** Funnel (customer-facing workflows only — see WorkflowRow's render). */
  sentRuns: number
  engagedRuns: number
}
type EffectivenessMap = Map<string, EffectivenessMetrics>

/**
 * The group's ids after dropping `activeId` onto `overId`, or null when the
 * drop is a no-op (same slot, or an id the group doesn't hold) and there is
 * nothing to persist.
 */
export function reorderGroup(
  ids: readonly string[],
  activeId: string,
  overId: string
): string[] | null {
  const from = ids.indexOf(activeId)
  const to = ids.indexOf(overId)
  if (from === -1 || to === -1 || from === to) return null
  return arrayMove([...ids], from, to)
}

/**
 * Each workflow's position in the race for a trigger's single customer-facing
 * first-match slot: the dispatcher tries live customer-facing workflows in
 * stored order and stops at the first that runs, so only those are ranked.
 * A paused or draft workflow can't win the slot and a background workflow
 * never competes for it, so neither takes a rank. Empty below two contenders,
 * where a lone winner has no priority worth showing.
 */
export function firstMatchRanks(items: readonly WorkflowDTO[]): Map<string, number> {
  const ranks = new Map<string, number>()
  const contenders = items.filter((wf) => wf.class === 'customer_facing' && wf.status === 'live')
  if (contenders.length < 2) return ranks
  contenders.forEach((wf, i) => ranks.set(wf.id, i + 1))
  return ranks
}

export function WorkflowsManager() {
  const navigate = useNavigate()
  const { data: workflows } = useQuery(workflowsQuery())
  const { data: effectiveness } = useQuery(workflowEffectivenessQuery())
  const create = useCreateWorkflow()
  const setStatus = useSetWorkflowStatus()
  const del = useDeleteWorkflow()
  const reorder = useReorderWorkflows()
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'any' | StatusValue>('any')
  const [typeFilter, setTypeFilter] = useState<'any' | (typeof CLASSES)[number]['value']>('any')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [deleting, setDeleting] = useState<WorkflowDTO | null>(null)
  const [runsWorkflow, setRunsWorkflow] = useState<WorkflowDTO | null>(null)

  const metricsByWorkflow: EffectivenessMap = useMemo(() => {
    const map: EffectivenessMap = new Map()
    for (const row of effectiveness ?? []) {
      map.set(row.workflowId, {
        started: row.started,
        completed: row.completed,
        sentRuns: row.sentRuns,
        engagedRuns: row.engagedRuns,
      })
    }
    return map
  }, [effectiveness])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (workflows ?? []).filter((wf) => {
      if (q && !wf.name.toLowerCase().includes(q)) return false
      if (statusFilter !== 'any' && wf.status !== statusFilter) return false
      if (typeFilter !== 'any' && wf.class !== typeFilter) return false
      return true
    })
  }, [workflows, search, statusFilter, typeFilter])

  const groups = useMemo(() => {
    const known = TRIGGERS.map((trigger) => ({
      trigger,
      items: filtered.filter((wf) => wf.triggerType === trigger.value),
    })).filter((g) => g.items.length > 0)
    const knownValues = new Set(TRIGGERS.map((t) => t.value))
    const other = filtered.filter((wf) => !knownValues.has(wf.triggerType))
    return other.length > 0 ? [...known, { trigger: OTHER_TRIGGER_META, items: other }] : known
  }, [filtered])

  const goToBuilder = (workflowId: string) => {
    void navigate({
      to: '/admin/automation/workflows/$workflowId',
      params: { workflowId },
    })
  }

  const createFromScratch = () => {
    create.mutate(
      {
        name: 'Untitled workflow',
        class: 'customer_facing',
        triggerType: 'conversation.created',
        graph: treeToGraph(newTree()),
      },
      {
        onSuccess: (wf) => goToBuilder(wf.id),
        onError: () => toast.error('Could not create the workflow'),
      }
    )
  }

  const createFromTemplate = (template: WorkflowTemplate) => {
    setGalleryOpen(false)
    create.mutate(template.payload, {
      onSuccess: (wf) => goToBuilder(wf.id),
      onError: () => toast.error('Could not create the workflow from this template'),
    })
  }

  const handleSetStatus = (id: string, status: StatusValue) =>
    setStatus.mutate({ id, status }, { onError: () => toast.error('Could not update status') })

  const handleDelete = () => {
    if (!deleting) return
    del.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError: () => toast.error('Could not delete workflow'),
    })
  }

  // A narrowed list shows a subset of each group in the same visual order, so a
  // drop inside it would silently decide the priority of rows it isn't showing.
  // Reordering is therefore only offered on the unfiltered list.
  const isFiltered = search.trim() !== '' || statusFilter !== 'any' || typeFilter !== 'any'

  const handleDragEnd = (items: WorkflowDTO[], event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const ids = reorderGroup(
      items.map((wf) => wf.id),
      String(active.id),
      String(over.id)
    )
    if (!ids) return
    reorder.mutate({ ids }, { onError: () => toast.error('Could not save the new priority') })
  }

  const hasAnyWorkflows = (workflows?.length ?? 0) > 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workflows…"
            aria-label="Search workflows"
            className="pl-8"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Status · Any</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Type · Any</SelectItem>
            {CLASSES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <PlusIcon className="mr-1.5 size-4" />
                New workflow
                <ChevronDownIcon className="ml-1.5 size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Deferred one tick: opening a dialog synchronously from a
                  dropdown's onSelect races the menu's own teardown — the
                  dialog captures the menu's body pointer-events lock as its
                  restore baseline, and closing it (or navigating away from
                  it) then leaves the whole page unclickable. */}
              <DropdownMenuItem onSelect={() => setTimeout(() => setGalleryOpen(true), 0)}>
                <SparklesIcon className="mr-2 size-4 text-primary" />
                Create from template
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={createFromScratch}>
                <PencilSquareIcon className="mr-2 size-4 text-muted-foreground" />
                Create from scratch
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!hasAnyWorkflows ? (
        <div className="rounded-lg border border-dashed">
          <EmptyState
            icon={BoltIcon}
            title="No workflows yet"
            description="Automate routing, SLAs, and replies from a trigger. Start from a template or build one from scratch."
          />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No workflows match these filters.
        </div>
      ) : (
        groups.map((group) => {
          const ranks = firstMatchRanks(group.items)
          return (
            <div key={group.trigger.value}>
              <GroupHeader
                trigger={group.trigger}
                count={group.items.length}
                contested={ranks.size > 0}
              />
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => handleDragEnd(group.items, event)}
              >
                <SortableContext
                  items={group.items.map((wf) => wf.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="divide-y rounded-lg border">
                    {group.items.map((wf) => (
                      <WorkflowRow
                        key={wf.id}
                        workflow={wf}
                        metrics={metricsByWorkflow.get(wf.id)}
                        rank={ranks.get(wf.id)}
                        contested={ranks.size > 0}
                        reorder={
                          group.items.length < 2 ? 'none' : isFiltered ? 'filtered' : 'enabled'
                        }
                        onNavigate={goToBuilder}
                        onSetStatus={handleSetStatus}
                        onDelete={setDeleting}
                        onViewRuns={setRunsWorkflow}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )
        })
      )}

      <WorkflowTemplateGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        onSelect={createFromTemplate}
      />

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title="Delete workflow"
          description={`"${deleting.name}" will be permanently deleted. This can't be undone.`}
          variant="destructive"
          confirmLabel={del.isPending ? 'Deleting…' : 'Delete workflow'}
          isPending={del.isPending}
          onConfirm={handleDelete}
        />
      )}

      <WorkflowRunsSheet
        workflowId={runsWorkflow?.id ?? null}
        workflowName={runsWorkflow?.name ?? ''}
        open={runsWorkflow !== null}
        onOpenChange={(open) => !open && setRunsWorkflow(null)}
      />
    </div>
  )
}

function GroupHeader({
  trigger,
  count,
  contested,
}: {
  trigger: TriggerMeta
  count: number
  /** Two or more live customer-facing workflows share this trigger's single
   *  first-match slot, so their order is a rule and not just a listing. */
  contested: boolean
}) {
  const Icon = trigger.icon
  return (
    <div className="mt-6 mb-2 flex items-center gap-2 text-sm font-semibold first:mt-0">
      <span
        className={cn('flex size-6 items-center justify-center rounded-md', trigger.colorClass)}
      >
        <Icon className="size-3.5" />
      </span>
      {trigger.label}
      <span className="font-normal text-muted-foreground">· {count}</span>
      {contested && (
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          Customer-facing: first match wins · drag to set priority
        </span>
      )}
    </div>
  )
}

/** First problem worth badging on a row: a structural graph error, or the
 *  first step whose config is unresolved (per `actionIssue`, which also treats
 *  template needs-setup placeholders as unset), including the class-rule
 *  check (Phase C, slice C-6) against the row's own stored class. Null when
 *  clean. */
function rowIssue(graph: unknown, workflowClass: WorkflowDTO['class']): string | null {
  const checked = validateGraph(graph)
  if (!checked.ok) return checked.error
  const tree = graphToTree(checked.value)
  if (!tree.ok) return tree.error
  const [first] = collectStepIssues(tree.value, workflowClass).values()
  return first ?? null
}

function WorkflowRow({
  workflow,
  metrics,
  rank,
  contested,
  reorder,
  onNavigate,
  onSetStatus,
  onDelete,
  onViewRuns,
}: {
  workflow: WorkflowDTO
  metrics: EffectivenessMetrics | undefined
  /** First-match priority within the trigger group, when this workflow is in
   *  the race for the slot at all (see firstMatchRanks). */
  rank: number | undefined
  /** The group ranks its contenders, so unranked rows hold the rank slot open
   *  and every name in the group stays on one line. */
  contested: boolean
  /** 'none' for a group of one, which has no order to set; 'filtered' while the
   *  list is narrowed, where a drop would silently reprioritize hidden rows. */
  reorder: 'enabled' | 'filtered' | 'none'
  onNavigate: (id: string) => void
  onSetStatus: (id: string, status: StatusValue) => void
  onDelete: (workflow: WorkflowDTO) => void
  onViewRuns: (workflow: WorkflowDTO) => void
}) {
  // Structural problems (bad JSON, cycles) and unresolved step config (a team
  // never picked, a template's needs-setup placeholder) both badge the row.
  const issue = rowIssue(workflow.graph, workflow.class)
  const status = STATUS_META[workflow.status as StatusValue] ?? STATUS_META.draft
  const started = metrics?.started ?? 0
  const completed = metrics?.completed ?? 0
  const isCustomerFacing = workflow.class === 'customer_facing'
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workflow.id,
    disabled: reorder !== 'enabled',
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(workflow.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onNavigate(workflow.id)
      }}
      className={cn(
        // The funnel line under the run count sets the metrics column width:
        // it reads as one line or not at all.
        'group relative grid cursor-pointer grid-cols-[20px_minmax(0,1fr)_92px_130px_210px_36px] items-center gap-3 bg-background px-4 py-3 hover:bg-muted/40',
        isDragging && 'z-10 shadow-lg'
      )}
    >
      {/* The handle carries the drag listeners, not the row: the row itself is
          the click target for the builder. The empty slot a group of one keeps
          holds every group's columns on the same grid. */}
      {reorder === 'none' ? (
        <span aria-hidden />
      ) : (
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          disabled={reorder === 'filtered'}
          aria-label={`Reorder ${workflow.name}`}
          title={reorder === 'filtered' ? 'Clear the filters to reorder' : 'Drag to set priority'}
          className="flex size-5 touch-none items-center justify-center rounded text-muted-foreground/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-muted-foreground/50 enabled:cursor-grab enabled:hover:bg-muted enabled:active:cursor-grabbing"
        >
          <Bars3Icon className="size-3.5" />
        </button>
      )}

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {rank !== undefined ? (
            <Badge
              data-testid="first-match-rank"
              size="sm"
              variant={rank === 1 ? 'default' : 'secondary'}
              className="size-5 shrink-0 px-0 tabular-nums"
              title={
                rank === 1
                  ? 'First match for this trigger'
                  : `Runs only if the ${rank - 1} above it do not match`
              }
            >
              {rank}
            </Badge>
          ) : (
            contested && <span aria-hidden className="size-5 shrink-0" />
          )}
          <span className="truncate text-sm font-semibold">{workflow.name}</span>
          {issue && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400"
              title={issue}
            >
              <ExclamationTriangleIcon className="size-3" />
              Needs setup
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Edited <TimeAgo date={workflow.updatedAt} />
        </div>
      </div>

      <span
        className={cn(
          'inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
          status.textClass
        )}
      >
        <span className={cn('size-1.5 rounded-full', status.dotClass)} />
        {status.label}
      </span>

      <span className="truncate text-xs text-muted-foreground">
        {workflow.class === 'customer_facing' ? 'Customer-facing' : 'Background'}
      </span>

      {/* The 7d started/completion metrics double as the run-history
          drill-down entry point (WorkflowRunsSheet) — stopPropagation so it
          doesn't also navigate to the builder like the rest of the row. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onViewRuns(workflow)
        }}
        title="View run history"
        className="flex flex-col items-end gap-0.5 rounded px-1 py-0.5 text-right text-xs font-medium tabular-nums hover:bg-muted hover:underline"
      >
        <span>
          {started > 0 ? (
            <>
              {started.toLocaleString()} · {Math.round((completed / started) * 100)}%
            </>
          ) : (
            '—'
          )}
        </span>
        {/* Funnel line (customer-facing only — a background workflow never
            sends a block, so it never has anything to funnel). Numbers only,
            muted, no new chrome — background workflows keep the display above
            exactly as it was. */}
        {isCustomerFacing && (
          <span className="font-normal text-muted-foreground no-underline">
            sent {(metrics?.sentRuns ?? 0).toLocaleString()} · engaged{' '}
            {(metrics?.engagedRuns ?? 0).toLocaleString()} · done {completed.toLocaleString()}
          </span>
        )}
      </button>

      <div onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Actions for ${workflow.name}`}
            >
              <EllipsisVerticalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onNavigate(workflow.id)}>Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
            {STATUSES.filter((s) => s !== workflow.status).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => onSetStatus(workflow.id, s)}>
                {STATUS_ACTION_LABEL[s]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {/* Same one-tick deferral as the gallery item above: the confirm
                dialog must open after the menu's teardown, not during it. */}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setTimeout(() => onDelete(workflow), 0)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
