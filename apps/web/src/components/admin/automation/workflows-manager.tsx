/**
 * Workflows manager (AI & Automation, support platform §4.6). A grouped,
 * filterable directory: customer-facing first (first-match order), then
 * background. "New workflow" lives in the page header and opens either the
 * template gallery or a blank draft. Editing happens on the fullscreen
 * builder route; this component lists, filters, and manages lifecycle.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
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
import {
  ChevronRightIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import { BoltIcon, ChevronDownIcon, EllipsisVerticalIcon } from '@heroicons/react/24/solid'
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
  ACTION_LABELS,
  BLOCK_STEP_LABELS,
  CONDITION_FIELD_META,
  countSetupIssues,
  graphToTree,
  isAttributeField,
  attributeKeyFromField,
  newTree,
  stepPaths,
  treeToGraph,
  triggerLabel,
  validateGraph,
  type GraphCondition,
  type TreeStep,
} from './workflow-graph'
import { WorkflowTemplateGallery } from './workflow-template-gallery'
import type { WorkflowTemplate } from './workflow-templates'
import { UpgradeModal } from '@/components/admin/upgrade'
import { isPlanRefusal } from '@/lib/shared/describe-upgrade'
import { WorkflowRunsSheet } from './workflow-runs-sheet'
import { cn } from '@/lib/shared/utils'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
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

const STATUSES = ['draft', 'live', 'paused'] as const
type StatusValue = (typeof STATUSES)[number]

const STATUS_META: Record<StatusValue, { label: string }> = {
  live: { label: 'Live' },
  paused: { label: 'Paused' },
  draft: { label: 'Draft' },
}

const STATUS_ACTION_LABEL: Record<StatusValue, string> = {
  live: 'Set live',
  paused: 'Pause',
  draft: 'Mark as draft',
}

type EffectivenessMetrics = {
  started: number
  completed: number
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
 * Each customer-facing workflow's visual rank in stored order — including
 * draft and paused rows. That is the order they will take when live.
 * Background workflows never take a rank.
 */
export function firstMatchRanks(items: readonly WorkflowDTO[]): Map<string, number> {
  const ranks = new Map<string, number>()
  items.filter((wf) => wf.class === 'customer_facing').forEach((wf, i) => ranks.set(wf.id, i + 1))
  return ranks
}

export function needsSetupBadgeText(counts: {
  branchOptions: number
  other: number
}): string | null {
  const total = counts.branchOptions + counts.other
  if (total === 0) return null
  if (counts.other === 0) {
    return counts.branchOptions === 1
      ? 'Needs setup · 1 branch option'
      : `Needs setup · ${counts.branchOptions} branch options`
  }
  return `Needs setup · ${total}`
}

function conditionFieldLabel(field: string): string {
  const staticMeta = (CONDITION_FIELD_META as Record<string, { label: string } | undefined>)[field]
  if (staticMeta) return staticMeta.label
  if (isAttributeField(field)) return attributeKeyFromField(field).replace(/_/g, ' ')
  return field
}

function firstConditionField(condition: GraphCondition | undefined): string | undefined {
  if (!condition || typeof condition !== 'object') return undefined
  const rec = condition as Record<string, unknown>
  if (typeof rec.field === 'string') return rec.field
  const children = [
    ...(Array.isArray(rec.all) ? rec.all : []),
    ...(Array.isArray(rec.any) ? rec.any : []),
  ]
  for (const child of children) {
    const field = firstConditionField(child as GraphCondition)
    if (field) return field
  }
  return undefined
}

function shortStepLabel(step: TreeStep): string {
  switch (step.kind) {
    case 'action':
      return ACTION_LABELS[step.action.type]
    case 'condition': {
      const field = firstConditionField(step.condition)
      return field ? conditionFieldLabel(field) : 'Condition'
    }
    case 'wait':
      return 'Wait'
    case 'branch': {
      const field = firstConditionField(step.paths[0]?.condition)
      return field ? `Branch on ${conditionFieldLabel(field)}` : 'Branch'
    }
    case 'message':
    case 'send_ticket_form':
    case 'show_reply_time':
    case 'disable_composer':
    case 'collect_data':
    case 'collect_reply':
    case 'let_assistant_answer':
    case 'reply_buttons':
    case 'request_csat':
      return BLOCK_STEP_LABELS[step.kind]
  }
}

export function workflowStepSummary(graph: unknown): string {
  const checked = validateGraph(graph)
  if (!checked.ok) return ''
  const tree = graphToTree(checked.value)
  if (!tree.ok) return ''
  const labels: string[] = []
  const walk = (steps: TreeStep[]) => {
    for (const step of steps) {
      if (labels.length >= 3) return
      labels.push(shortStepLabel(step))
      const paths = stepPaths(step)
      if (paths) {
        for (const path of paths) walk(path.steps)
      }
    }
  }
  walk(tree.value.steps)
  return labels.join(' · ')
}

export function WorkflowsManager({
  entitled = true,
  children,
}: {
  entitled?: boolean
  children?: ReactNode
}) {
  const intl = useIntl()
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
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [deleting, setDeleting] = useState<WorkflowDTO | null>(null)
  const [runsWorkflow, setRunsWorkflow] = useState<WorkflowDTO | null>(null)

  const refuseOr = (run: () => void) => {
    if (!entitled) {
      setUpgradeOpen(true)
      return
    }
    run()
  }

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

  const groups = useMemo(
    () =>
      CLASSES.map((cls) => ({
        cls,
        items: filtered.filter((wf) => wf.class === cls.value),
      })).filter((g) => g.items.length > 0),
    [filtered]
  )

  const ranks = useMemo(() => firstMatchRanks(workflows ?? []), [workflows])

  const goToBuilder = (workflowId: string) => {
    void navigate({
      to: '/admin/automation/workflows/$workflowId',
      params: { workflowId },
    })
  }

  const createFromScratch = () => {
    refuseOr(() => {
      create.mutate(
        {
          name: 'Untitled workflow',
          class: 'customer_facing',
          triggerType: 'conversation.created',
          graph: treeToGraph(newTree()),
        },
        {
          onSuccess: (wf) => goToBuilder(wf.id),
          onError: (error) => {
            if (isPlanRefusal(error)) setUpgradeOpen(true)
            else toast.error('Could not create the workflow')
          },
        }
      )
    })
  }

  const createFromTemplate = (template: WorkflowTemplate) => {
    setGalleryOpen(false)
    refuseOr(() => {
      create.mutate(template.payload, {
        onSuccess: (wf) => goToBuilder(wf.id),
        onError: (error) => {
          if (isPlanRefusal(error)) setUpgradeOpen(true)
          else toast.error('Could not create the workflow from this template')
        },
      })
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

  const newWorkflowMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <PlusIcon className="size-4" />
          {intl.formatMessage({
            id: 'automation.workflows.new',
            defaultMessage: 'New workflow',
          })}
          <ChevronDownIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Deferred one tick: opening a dialog synchronously from a
            dropdown's onSelect races the menu's own teardown — the
            dialog captures the menu's body pointer-events lock as its
            restore baseline, and closing it (or navigating away from
            it) then leaves the whole page unclickable. */}
        <DropdownMenuItem
          onSelect={() =>
            refuseOr(() => {
              setTimeout(() => setGalleryOpen(true), 0)
            })
          }
        >
          <SparklesIcon className="mr-2 size-4 text-primary" />
          {intl.formatMessage({
            id: 'automation.workflows.fromTemplate',
            defaultMessage: 'Create from template',
          })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={createFromScratch}>
          <PencilSquareIcon className="mr-2 size-4 text-muted-foreground" />
          {intl.formatMessage({
            id: 'automation.workflows.fromScratch',
            defaultMessage: 'Create from scratch',
          })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BoltIcon}
        title={intl.formatMessage({
          id: 'automation.workflows.title',
          defaultMessage: 'Workflows',
        })}
        description={intl.formatMessage({
          id: 'automation.workflows.description',
          defaultMessage:
            'Automate routing, replies, and housekeeping on top of your conversations.',
        })}
        action={newWorkflowMenu}
      />

      {children}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={intl.formatMessage({
                id: 'automation.workflows.search',
                defaultMessage: 'Search workflows…',
              })}
              aria-label={intl.formatMessage({
                id: 'automation.workflows.search',
                defaultMessage: 'Search workflows…',
              })}
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
        </div>

        {!hasAnyWorkflows ? (
          <div className="rounded-lg border border-dashed">
            <EmptyState
              icon={BoltIcon}
              title={intl.formatMessage({
                id: 'automation.workflows.emptyTitle',
                defaultMessage: 'No workflows yet',
              })}
              description={intl.formatMessage({
                id: 'automation.workflows.emptyDescription',
                defaultMessage:
                  'Automate routing, SLAs, and replies from a trigger. Start from a template or build one from scratch.',
              })}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    refuseOr(() => {
                      setTimeout(() => setGalleryOpen(true), 0)
                    })
                  }
                >
                  {intl.formatMessage({
                    id: 'automation.workflows.fromTemplate',
                    defaultMessage: 'Create from template',
                  })}
                </Button>
              }
            />
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {intl.formatMessage({
              id: 'automation.workflows.noMatch',
              defaultMessage: 'No workflows match these filters.',
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            {groups.map((group, groupIndex) => {
              const isCustomerFacing = group.cls.value === 'customer_facing'
              const reorderMode: 'enabled' | 'filtered' | 'none' = !isCustomerFacing
                ? 'none'
                : group.items.length < 2
                  ? 'none'
                  : isFiltered
                    ? 'filtered'
                    : 'enabled'
              return (
                <div key={group.cls.value} className={groupIndex > 0 ? 'border-t' : undefined}>
                  <GroupHeader
                    label={
                      group.cls.value === 'customer_facing'
                        ? intl.formatMessage({
                            id: 'automation.workflows.customerFacing',
                            defaultMessage: 'Customer-facing',
                          })
                        : intl.formatMessage({
                            id: 'automation.workflows.background',
                            defaultMessage: 'Background',
                          })
                    }
                    count={group.items.length}
                    dragHint={
                      isCustomerFacing && !isFiltered
                        ? intl.formatMessage({
                            id: 'automation.workflows.firstMatchHint',
                            defaultMessage: 'Priority when live · drafts do not run',
                          })
                        : null
                    }
                  />
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(event) => {
                      if (reorderMode === 'enabled') handleDragEnd(group.items, event)
                    }}
                  >
                    <SortableContext
                      items={group.items.map((wf) => wf.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="divide-y">
                        {group.items.map((wf) => (
                          <WorkflowRow
                            key={wf.id}
                            workflow={wf}
                            metrics={metricsByWorkflow.get(wf.id)}
                            rank={isCustomerFacing ? ranks.get(wf.id) : undefined}
                            reorder={reorderMode}
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
            })}
          </div>
        )}
      </div>

      <WorkflowTemplateGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        onSelect={createFromTemplate}
      />
      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} entitlement="workflows" />

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
  label,
  count,
  dragHint,
}: {
  label: string
  count: number
  dragHint: string | null
}) {
  return (
    <div className="flex items-center gap-2 bg-muted/30 px-4 py-2">
      <span className="text-[13px] font-semibold">{label}</span>
      <Badge size="sm" shape="pill" variant="secondary">
        {count}
      </Badge>
      {dragHint && (
        <span className="ml-auto text-[11px] font-medium text-muted-foreground">{dragHint}</span>
      )}
    </div>
  )
}

function rowSetup(workflow: WorkflowDTO): { branchOptions: number; other: number } {
  const checked = validateGraph(workflow.graph)
  if (!checked.ok) return { branchOptions: 0, other: 1 }
  const tree = graphToTree(checked.value)
  if (!tree.ok) return { branchOptions: 0, other: 1 }
  const audience = workflow.triggerSettings?.audience
  return countSetupIssues(
    tree.value,
    workflow.class,
    audience && typeof audience === 'object' ? { audience: audience as GraphCondition } : undefined
  )
}

function WorkflowRow({
  workflow,
  metrics,
  rank,
  reorder,
  onNavigate,
  onSetStatus,
  onDelete,
  onViewRuns,
}: {
  workflow: WorkflowDTO
  metrics: EffectivenessMetrics | undefined
  rank: number | undefined
  /** 'none' for a group of one or background rows; 'filtered' while the
   *  list is narrowed, where a drop would silently reprioritize hidden rows. */
  reorder: 'enabled' | 'filtered' | 'none'
  onNavigate: (id: string) => void
  onSetStatus: (id: string, status: StatusValue) => void
  onDelete: (workflow: WorkflowDTO) => void
  onViewRuns: (workflow: WorkflowDTO) => void
}) {
  const needsSetup = needsSetupBadgeText(rowSetup(workflow))
  const started = metrics?.started ?? 0
  const completed = metrics?.completed ?? 0
  const trigger = triggerLabel(workflow.triggerType)
  const showMetrics = workflow.status === 'live' && started > 0
  const metricsText = showMetrics
    ? `${started.toLocaleString()} runs · ${Math.round((completed / started) * 100)}% completed (7d)`
    : ''
  const stepSummary = showMetrics ? '' : workflowStepSummary(workflow.graph)
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
        'group relative flex cursor-pointer items-center gap-3 bg-background px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
        isDragging && 'z-10 shadow-lg'
      )}
    >
      {rank !== undefined &&
        (reorder === 'none' ? (
          <span
            data-testid="first-match-rank"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground"
          >
            {rank}
          </span>
        ) : (
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            disabled={reorder === 'filtered'}
            aria-label={`Reorder ${workflow.name}`}
            data-testid="first-match-rank"
            title={reorder === 'filtered' ? 'Clear the filters to reorder' : 'Drag to set priority'}
            className="flex size-5 shrink-0 touch-none items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-30 enabled:cursor-grab enabled:hover:bg-muted-foreground/15 enabled:active:cursor-grabbing"
          >
            {rank}
          </button>
        ))}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold">{workflow.name}</span>
          <WorkflowStatusBadge
            status={(workflow.status as StatusValue) ?? 'draft'}
            needsSetup={needsSetup}
          />
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {trigger}
          {metricsText ? (
            <>
              {' · '}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onViewRuns(workflow)
                }}
                title="View run history"
                className="hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {metricsText}
              </button>
            </>
          ) : stepSummary ? (
            <> · {stepSummary}</>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
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
            <DropdownMenuItem onSelect={() => onViewRuns(workflow)}>View runs</DropdownMenuItem>
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
        <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
      </div>
    </div>
  )
}

function WorkflowStatusBadge({
  status,
  needsSetup,
}: {
  status: StatusValue
  needsSetup: string | null
}) {
  return (
    <>
      {status === 'live' ? (
        <Badge
          size="sm"
          shape="pill"
          className="border-transparent bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400"
        >
          Live
        </Badge>
      ) : status === 'paused' ? (
        <Badge
          size="sm"
          shape="pill"
          className="border-transparent bg-amber-500/10 font-medium text-amber-700 dark:text-amber-400"
        >
          Paused
        </Badge>
      ) : (
        <Badge size="sm" shape="pill" variant="secondary">
          Draft
        </Badge>
      )}
      {needsSetup && (
        <Badge
          size="sm"
          shape="pill"
          className="gap-1 border-transparent bg-amber-500/10 font-medium text-amber-700 dark:text-amber-400"
          title={needsSetup}
        >
          <ExclamationTriangleIcon className="size-3" />
          {needsSetup}
        </Badge>
      )}
    </>
  )
}
