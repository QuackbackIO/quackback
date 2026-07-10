/**
 * Workflows manager (AI & Automation, support platform §4.6). A grouped,
 * filterable directory: workflows are bucketed by trigger type (in catalogue
 * order), each row shows lifecycle + class + trailing-7-day run metrics, and
 * "New workflow" opens either the template gallery or a blank draft. Editing
 * happens on the fullscreen builder route; this component only lists,
 * filters, and manages lifecycle (status, delete).
 */
import { useMemo, useState, type ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  ArrowPathIcon,
  BoltIcon,
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  FlagIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  SparklesIcon,
  StarIcon,
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
import { cn } from '@/lib/shared/utils'
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

type EffectivenessMap = Map<string, { started: number; completed: number }>

export function WorkflowsManager() {
  const navigate = useNavigate()
  const { data: workflows } = useQuery(workflowsQuery())
  const { data: effectiveness } = useQuery(workflowEffectivenessQuery())
  const create = useCreateWorkflow()
  const setStatus = useSetWorkflowStatus()
  const del = useDeleteWorkflow()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'any' | StatusValue>('any')
  const [typeFilter, setTypeFilter] = useState<'any' | (typeof CLASSES)[number]['value']>('any')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [deleting, setDeleting] = useState<WorkflowDTO | null>(null)

  const metricsByWorkflow: EffectivenessMap = useMemo(() => {
    const map: EffectivenessMap = new Map()
    for (const row of effectiveness ?? []) {
      map.set(row.workflowId, { started: row.started, completed: row.completed })
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
              <DropdownMenuItem onSelect={() => setGalleryOpen(true)}>
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
        groups.map((group) => (
          <div key={group.trigger.value}>
            <GroupHeader trigger={group.trigger} count={group.items.length} />
            <div className="divide-y rounded-lg border">
              {group.items.map((wf) => (
                <WorkflowRow
                  key={wf.id}
                  workflow={wf}
                  metrics={metricsByWorkflow.get(wf.id)}
                  onNavigate={goToBuilder}
                  onSetStatus={handleSetStatus}
                  onDelete={setDeleting}
                />
              ))}
            </div>
          </div>
        ))
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
    </div>
  )
}

function GroupHeader({ trigger, count }: { trigger: TriggerMeta; count: number }) {
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
  onNavigate,
  onSetStatus,
  onDelete,
}: {
  workflow: WorkflowDTO
  metrics: { started: number; completed: number } | undefined
  onNavigate: (id: string) => void
  onSetStatus: (id: string, status: StatusValue) => void
  onDelete: (workflow: WorkflowDTO) => void
}) {
  // Structural problems (bad JSON, cycles) and unresolved step config (a team
  // never picked, a template's needs-setup placeholder) both badge the row.
  const issue = rowIssue(workflow.graph, workflow.class)
  const status = STATUS_META[workflow.status as StatusValue] ?? STATUS_META.draft
  const started = metrics?.started ?? 0
  const completed = metrics?.completed ?? 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(workflow.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onNavigate(workflow.id)
      }}
      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_92px_130px_72px_64px_36px] items-center gap-3 px-4 py-3 hover:bg-muted/40"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
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

      <span className="text-right text-xs font-medium tabular-nums">
        {started > 0 ? started.toLocaleString() : '—'}
      </span>

      <span className="text-right text-xs font-medium tabular-nums">
        {started > 0 ? `${Math.round((completed / started) * 100)}%` : '—'}
      </span>

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
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(workflow)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
