/**
 * The workflow builder canvas (support platform §4.6): an auto-layout tree of
 * steps, not a free-form node editor. The trigger sits at the top, steps run
 * top-to-bottom, and a branch step fans out into labeled paths that each run
 * their own column. Steps are inserted from "+" connectors, edited in
 * popovers, and everything round-trips losslessly through the workflow graph
 * JSON (workflow-graph.ts), which stays the single source of truth. An "Edit
 * as JSON" mode exposes that JSON directly; graphs the tree layout cannot
 * show (merges, orphans) open there instead of being rewritten.
 */
import { createContext, Fragment, useContext, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BoltIcon,
  CheckCircleIcon,
  ClockIcon,
  CodeBracketIcon,
  FlagIcon,
  FunnelIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  RectangleGroupIcon,
  ShareIcon,
  ShieldCheckIcon,
  TagIcon,
  UserGroupIcon,
  UserPlusIcon,
  XMarkIcon,
  AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { useTeamMembers } from '@/lib/client/hooks/use-team-members'
import { useInboxTeams } from '@/components/admin/conversation/inbox-nav-sidebar'
import { fetchConversationTagsFn } from '@/lib/server/functions/conversation-tags'
import { listSlaPolicyOptionsFn } from '@/lib/server/functions/sla'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ACTION_LABELS,
  ACTION_TYPES,
  CONDITION_FIELD_LIST,
  CONDITION_FIELD_META,
  OPERATOR_LABELS,
  OPERATORS_BY_KIND,
  PRIORITIES,
  PRIORITY_LABELS,
  VALUELESS_OPERATORS,
  WAIT_UNITS,
  actionSummary,
  attributeValueText,
  conditionSummary,
  conditionToDraft,
  countSteps,
  createStep,
  defaultAction,
  defaultRule,
  draftToCondition,
  graphToTree,
  insertStep,
  parseAttributeValue,
  parseWorkflowGraphText,
  secondsToWaitParts,
  treeToGraph,
  waitSummary,
  type ActionType,
  type BranchPath,
  type ConditionOperator,
  type ConditionRuleDraft,
  type EntityLabels,
  type GraphAction,
  type GraphCondition,
  type GraphDraft,
  type SimpleConditionDraft,
  type TreeStep,
  type WaitUnit,
  type WorkflowTree,
} from './workflow-graph'

// ---------------------------------------------------------------------------
// Editor shell: the Steps header with the visual/JSON toggle
// ---------------------------------------------------------------------------

export function WorkflowGraphEditor({
  draft,
  onDraftChange,
  triggerLabel,
  error,
}: {
  draft: GraphDraft
  onDraftChange: (draft: GraphDraft) => void
  triggerLabel: string
  /** A save-time validation error from the parent, shown under the editor. */
  error?: string | null
}) {
  const [toggleError, setToggleError] = useState<string | null>(null)

  const change = (next: GraphDraft) => {
    setToggleError(null)
    onDraftChange(next)
  }

  const showJson = () => {
    if (draft.mode !== 'visual') return
    change({ mode: 'json', text: JSON.stringify(treeToGraph(draft.tree), null, 2) })
  }

  const showVisual = () => {
    if (draft.mode !== 'json') return
    const parsed = parseWorkflowGraphText(draft.text)
    if (!parsed.ok) return setToggleError(parsed.error)
    const tree = graphToTree(parsed.value)
    if (!tree.ok)
      return setToggleError(`The visual builder needs a single tree of paths: ${tree.error}.`)
    change({ mode: 'visual', tree: tree.value })
  }

  const shownError = toggleError ?? error

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>Steps</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={draft.mode === 'visual' ? showJson : showVisual}
        >
          {draft.mode === 'visual' ? (
            <>
              <CodeBracketIcon className="size-3.5" /> Edit as JSON
            </>
          ) : (
            <>
              <RectangleGroupIcon className="size-3.5" /> Visual builder
            </>
          )}
        </Button>
      </div>

      {draft.mode === 'visual' ? (
        <WorkflowCanvas
          tree={draft.tree}
          onChange={(tree) => change({ mode: 'visual', tree })}
          triggerLabel={triggerLabel}
        />
      ) : (
        <div className="space-y-1.5">
          {draft.notice && (
            <p className="text-xs text-amber-600 dark:text-amber-500">{draft.notice}</p>
          )}
          <Textarea
            value={draft.text}
            onChange={(e) => change({ ...draft, text: e.target.value })}
            className="min-h-64 font-mono text-xs"
            spellCheck={false}
            aria-label="Workflow graph JSON"
          />
        </div>
      )}

      {shownError && <p className="text-xs text-destructive">{shownError}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Canvas data: entity options for the editors, id -> name labels for the
// cards, and the step factory / auto-open bookkeeping.
// ---------------------------------------------------------------------------

interface EntityOption {
  id: string
  name: string
}

interface CanvasData {
  members: EntityOption[]
  teams: EntityOption[]
  tags: EntityOption[]
  /** Live SLA policies for the Apply-SLA picker, with their targets line. */
  slaPolicies: { id: string; name: string; targetsSummary: string }[]
  labels: EntityLabels
  makeStep: (kind: TreeStep['kind']) => TreeStep
  justInserted: string | null
  markInserted: (id: string | null) => void
}

const CanvasContext = createContext<CanvasData | null>(null)

function useCanvas(): CanvasData {
  const ctx = useContext(CanvasContext)
  if (!ctx) throw new Error('useCanvas must be used inside WorkflowCanvas')
  return ctx
}

const toMap = (items: EntityOption[]) => new Map(items.map((i) => [i.id, i.name]))

function WorkflowCanvas({
  tree,
  onChange,
  triggerLabel,
}: {
  tree: WorkflowTree
  onChange: (tree: WorkflowTree) => void
  triggerLabel: string
}) {
  const { data: members } = useTeamMembers()
  const { data: teams } = useInboxTeams()
  const { data: tags } = useQuery({
    queryKey: ['admin', 'conversation-tags', 'all'],
    queryFn: () => fetchConversationTagsFn(),
    staleTime: 60_000,
  })
  const { data: slaPolicies } = useQuery({
    queryKey: ['admin', 'sla-policy-options'],
    queryFn: () => listSlaPolicyOptionsFn(),
    staleTime: 60_000,
  })
  const [justInserted, setJustInserted] = useState<string | null>(null)

  const data = useMemo<CanvasData>(() => {
    const memberOptions = (members ?? []).map((m) => ({ id: m.id, name: m.name ?? 'Unnamed' }))
    const teamOptions = (teams ?? []).map((t) => ({ id: t.id, name: t.name }))
    const tagOptions = (tags ?? []).map((t) => ({ id: t.id, name: t.name }))
    const slaOptions = slaPolicies ?? []
    return {
      members: memberOptions,
      teams: teamOptions,
      tags: tagOptions,
      slaPolicies: slaOptions,
      labels: {
        members: toMap(memberOptions),
        teams: toMap(teamOptions),
        tags: toMap(tagOptions),
        slaPolicies: toMap(slaOptions),
      },
      makeStep: (kind) => createStep(tree, kind),
      justInserted,
      markInserted: setJustInserted,
    }
  }, [members, teams, tags, slaPolicies, tree, justInserted])

  return (
    <CanvasContext.Provider value={data}>
      <div className="max-h-[52vh] min-h-[300px] overflow-auto rounded-lg border bg-muted/20 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px]">
        <div className="flex w-max min-w-full flex-col items-center px-8 py-7">
          <TriggerCard label={triggerLabel} />
          <StepList
            steps={tree.steps}
            onStepsChange={(steps) => onChange({ ...tree, steps })}
            root
          />
        </div>
      </div>
    </CanvasContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Layout pieces: one path column, connectors, the "+" insert menu
// ---------------------------------------------------------------------------

function StepList({
  steps,
  onStepsChange,
  root = false,
}: {
  steps: TreeStep[]
  onStepsChange: (steps: TreeStep[]) => void
  root?: boolean
}) {
  const insertAt = (index: number, step: TreeStep) => onStepsChange(insertStep(steps, index, step))
  const updateAt = (index: number, step: TreeStep) =>
    onStepsChange(steps.map((s, i) => (i === index ? step : s)))
  const removeAt = (index: number) => onStepsChange(steps.filter((_, i) => i !== index))

  const endsInBranch = steps[steps.length - 1]?.kind === 'branch'

  return (
    <>
      {steps.map((step, i) => (
        <Fragment key={step.id}>
          <Connector onInsert={(s) => insertAt(i, s)} />
          <StepCard step={step} onChange={(s) => updateAt(i, s)} onDelete={() => removeAt(i)} />
        </Fragment>
      ))}
      {!endsInBranch && (
        <>
          <Connector end onInsert={(s) => insertAt(steps.length, s)} />
          {root && steps.length === 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">Add the first step</p>
          )}
        </>
      )}
    </>
  )
}

/** The vertical line between steps, with the "+" insert affordance. */
function Connector({
  onInsert,
  end = false,
}: {
  onInsert: (step: TreeStep) => void
  end?: boolean
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="h-2.5 w-px bg-border" />
      <InsertMenu onInsert={onInsert} />
      {!end && <div className="h-2.5 w-px bg-border" />}
    </div>
  )
}

const INSERT_OPTIONS: {
  kind: TreeStep['kind']
  label: string
  description: string
  icon: typeof PlayIcon
}[] = [
  { kind: 'action', label: 'Action', description: 'Assign, tag, close, and more', icon: PlayIcon },
  {
    kind: 'condition',
    label: 'Condition',
    description: 'Continue only if rules match',
    icon: FunnelIcon,
  },
  { kind: 'branch', label: 'Branch', description: 'Split into first-match paths', icon: ShareIcon },
  { kind: 'wait', label: 'Wait', description: 'Pause before the next step', icon: ClockIcon },
]

function InsertMenu({ onInsert }: { onInsert: (step: TreeStep) => void }) {
  const { makeStep, markInserted } = useCanvas()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Add step"
          className="flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <PlusIcon className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        {INSERT_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.kind}
            onSelect={() => {
              const step = makeStep(opt.kind)
              onInsert(step)
              markInserted(step.id)
            }}
          >
            <opt.icon className="size-4 text-muted-foreground" />
            <span className="flex min-w-0 flex-col">
              <span className="text-[13px]">{opt.label}</span>
              <span className="text-xs text-muted-foreground">{opt.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const CARD_CLASS =
  'w-60 rounded-lg border bg-background p-2.5 text-left shadow-xs transition-colors'

function CardBody({
  icon: Icon,
  tint,
  eyebrow,
  title,
}: {
  icon: typeof BoltIcon
  tint: string
  eyebrow: string
  title: string
}) {
  return (
    <span className="flex items-start gap-2.5">
      <span
        className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md', tint)}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {eyebrow}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug font-medium">
          {title}
        </span>
      </span>
    </span>
  )
}

function TriggerCard({ label }: { label: string }) {
  return (
    <div className={cn(CARD_CLASS, 'border-primary/25')}>
      <CardBody icon={BoltIcon} tint="bg-primary/10 text-primary" eyebrow="Trigger" title={label} />
    </div>
  )
}

function DeleteStepButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="pointer-events-none absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-xs transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 hover:text-destructive focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <XMarkIcon className="size-3" />
    </button>
  )
}

const ACTION_ICONS: Record<ActionType, typeof BoltIcon> = {
  assign_agent: UserPlusIcon,
  assign_team: UserGroupIcon,
  add_tag: TagIcon,
  remove_tag: TagIcon,
  set_priority: FlagIcon,
  snooze: MoonIcon,
  close: CheckCircleIcon,
  apply_sla: ShieldCheckIcon,
  set_attribute: AdjustmentsHorizontalIcon,
}

const GATE_TINT = 'bg-amber-500/10 text-amber-600 dark:text-amber-500'
const STEP_TINT = 'bg-muted text-muted-foreground'

function StepCard({
  step,
  onChange,
  onDelete,
}: {
  step: TreeStep
  onChange: (step: TreeStep) => void
  onDelete: () => void
}) {
  const { labels } = useCanvas()
  switch (step.kind) {
    case 'action':
      return (
        <EditableCard
          stepId={step.id}
          icon={ACTION_ICONS[step.action.type]}
          tint={STEP_TINT}
          eyebrow="Action"
          title={actionSummary(step.action, labels)}
          onDelete={onDelete}
          deleteLabel="Delete action step"
        >
          <ActionEditor action={step.action} onChange={(action) => onChange({ ...step, action })} />
        </EditableCard>
      )
    case 'condition':
      return (
        <EditableCard
          stepId={step.id}
          icon={FunnelIcon}
          tint={GATE_TINT}
          eyebrow="Condition"
          title={conditionSummary(step.condition)}
          onDelete={onDelete}
          deleteLabel="Delete condition step"
        >
          <ConditionEditor
            subject="Continue when"
            condition={step.condition}
            onChange={(condition) => onChange({ ...step, condition })}
          />
        </EditableCard>
      )
    case 'wait':
      return (
        <EditableCard
          stepId={step.id}
          icon={ClockIcon}
          tint={STEP_TINT}
          eyebrow="Wait"
          title={waitSummary(step.seconds)}
          onDelete={onDelete}
          deleteLabel="Delete wait step"
        >
          <WaitEditor
            seconds={step.seconds}
            onChange={(seconds) => onChange({ ...step, seconds })}
          />
        </EditableCard>
      )
    case 'branch':
      return <BranchStep step={step} onChange={onChange} onDelete={onDelete} />
  }
}

/** A step card that opens its editor in a popover (auto-opens right after insert). */
function EditableCard({
  stepId,
  icon,
  tint,
  eyebrow,
  title,
  onDelete,
  deleteLabel,
  children,
}: {
  stepId: string
  icon: typeof BoltIcon
  tint: string
  eyebrow: string
  title: string
  onDelete: () => void
  deleteLabel: string
  children: React.ReactNode
}) {
  const { justInserted, markInserted } = useCanvas()
  return (
    <div className="group relative">
      <Popover
        defaultOpen={justInserted === stepId}
        onOpenChange={(open) => {
          if (!open && justInserted === stepId) markInserted(null)
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              CARD_CLASS,
              'cursor-pointer hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
            )}
          >
            <CardBody icon={icon} tint={tint} eyebrow={eyebrow} title={title} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-80 p-3">
          {children}
        </PopoverContent>
      </Popover>
      <DeleteStepButton label={deleteLabel} onClick={onDelete} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Branch: the card, the labeled child paths, and the add-path affordance
// ---------------------------------------------------------------------------

function BranchStep({
  step,
  onChange,
  onDelete,
}: {
  step: Extract<TreeStep, { kind: 'branch' }>
  onChange: (step: TreeStep) => void
  onDelete: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const nested = step.paths.reduce((n, p) => n + countSteps(p.steps), 0)

  const updatePath = (index: number, path: BranchPath) =>
    onChange({ ...step, paths: step.paths.map((p, i) => (i === index ? path : p)) })
  const removePath = (index: number) =>
    onChange({ ...step, paths: step.paths.filter((_, i) => i !== index) })
  const addPath = () => {
    const used = new Set(step.paths.map((p) => p.key))
    let n = step.paths.length + 1
    while (used.has(`Path ${n}`)) n++
    onChange({ ...step, paths: [...step.paths, { key: `Path ${n}`, condition: {}, steps: [] }] })
  }

  return (
    <div className="flex flex-col items-center">
      <div className="group relative">
        <div className={cn(CARD_CLASS, 'cursor-default')}>
          <CardBody
            icon={ShareIcon}
            tint={GATE_TINT}
            eyebrow="Branch"
            title={`${step.paths.length} path${step.paths.length === 1 ? '' : 's'} · first match runs`}
          />
        </div>
        <DeleteStepButton
          label="Delete branch step"
          onClick={() => (nested > 0 ? setConfirmOpen(true) : onDelete())}
        />
      </div>

      <div className="h-2.5 w-px bg-border" />
      <div className="flex items-start">
        {/* Index keys: renaming a path must not remount its column (and close
            the rename popover); paths are identified positionally. */}
        {step.paths.map((path, i) => (
          <div key={i} className="relative flex flex-col items-center px-3 pt-2.5">
            <div
              className={cn(
                'absolute top-0 h-px bg-border',
                i === 0 ? 'right-0 left-1/2' : 'inset-x-0'
              )}
            />
            <div className="absolute top-0 left-1/2 h-2.5 w-px -translate-x-1/2 bg-border" />
            <PathHeader
              path={path}
              siblingKeys={step.paths.filter((_, j) => j !== i).map((p) => p.key)}
              onChange={(p) => updatePath(i, p)}
              onRemove={() => removePath(i)}
            />
            <StepList
              steps={path.steps}
              onStepsChange={(steps) => updatePath(i, { ...path, steps })}
            />
          </div>
        ))}

        <div className="relative flex flex-col items-center px-3 pt-2.5">
          {step.paths.length > 0 && (
            <div className="absolute top-0 right-1/2 left-0 h-px bg-border" />
          )}
          <div className="absolute top-0 left-1/2 h-2.5 w-px -translate-x-1/2 border-l border-dashed border-border" />
          <button
            type="button"
            aria-label="Add path"
            onClick={addPath}
            className="mt-2 flex size-6 items-center justify-center rounded-full border border-dashed bg-background text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
      </div>

      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this branch?"
        description={`Its paths and their ${nested} step${nested === 1 ? '' : 's'} will be removed.`}
        onConfirm={onDelete}
      />
    </div>
  )
}

function PathHeader({
  path,
  siblingKeys,
  onChange,
  onRemove,
}: {
  path: BranchPath
  siblingKeys: string[]
  onChange: (path: BranchPath) => void
  onRemove: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const stepCount = countSteps(path.steps)

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="max-w-56 truncate rounded-full border bg-background px-2.5 py-1 text-xs font-medium shadow-xs transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {path.key}
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-80 space-y-3 p-3">
          <PathNameField
            value={path.key}
            siblingKeys={siblingKeys}
            onRename={(key) => onChange({ ...path, key })}
          />
          <ConditionEditor
            subject="Runs when"
            condition={path.condition}
            onChange={(condition) => onChange({ ...path, condition })}
          />
          <div className="flex items-center justify-between border-t pt-2.5">
            <span className="text-[11px] text-muted-foreground">First matching path runs</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              onClick={() => (stepCount > 0 ? setConfirmOpen(true) : onRemove())}
            >
              Remove path
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <span className="mt-1 max-w-52 truncate text-center text-[11px] text-muted-foreground">
        {conditionSummary(path.condition)}
      </span>

      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove "${path.key}"?`}
        description={`Its ${stepCount} step${stepCount === 1 ? '' : 's'} will be removed with it.`}
        onConfirm={onRemove}
      />
    </>
  )
}

/** Path rename with local text state: commits on blur when non-empty + unique. */
function PathNameField({
  value,
  siblingKeys,
  onRename,
}: {
  value: string
  siblingKeys: string[]
  onRename: (key: string) => void
}) {
  const [text, setText] = useState(value)
  const [error, setError] = useState<string | null>(null)

  const commit = () => {
    const next = text.trim()
    if (!next || next === value) {
      setText(value)
      setError(null)
      return
    }
    if (siblingKeys.includes(next)) {
      setError('Another path already uses this name.')
      return
    }
    setError(null)
    onRename(next)
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs">Path name</Label>
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="h-8 text-sm"
        maxLength={60}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// Step editors
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

function EntitySelect({
  value,
  placeholder,
  items,
  onChange,
}: {
  value: string
  placeholder: string
  items: EntityOption[]
  onChange: (id: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ActionEditor({
  action,
  onChange,
}: {
  action: GraphAction
  onChange: (action: GraphAction) => void
}) {
  const { members, teams, tags, slaPolicies } = useCanvas()

  const setSnoozeUntil = (mode: 'reply' | 'datetime') => {
    if (mode === 'reply') return onChange({ type: 'snooze', untilIso: null })
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    onChange({ type: 'snooze', untilIso: d.toISOString() })
  }

  return (
    <div className="space-y-3">
      <Field label="Action">
        <Select
          value={action.type}
          onValueChange={(v) => v !== action.type && onChange(defaultAction(v as ActionType))}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {ACTION_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {action.type === 'assign_agent' && (
        <Field label="Teammate">
          <EntitySelect
            value={action.principalId}
            placeholder="Choose teammate"
            items={members}
            onChange={(principalId) => onChange({ ...action, principalId })}
          />
        </Field>
      )}

      {action.type === 'assign_team' && (
        <Field label="Team">
          <EntitySelect
            value={action.teamId}
            placeholder="Choose team"
            items={teams}
            onChange={(teamId) => onChange({ ...action, teamId })}
          />
        </Field>
      )}

      {(action.type === 'add_tag' || action.type === 'remove_tag') && (
        <Field label="Tag">
          <EntitySelect
            value={action.tagId}
            placeholder="Choose tag"
            items={tags}
            onChange={(tagId) => onChange({ ...action, tagId })}
          />
        </Field>
      )}

      {action.type === 'set_priority' && (
        <Field label="Priority">
          <Select
            value={action.priority}
            onValueChange={(priority) =>
              onChange({ ...action, priority: priority as typeof action.priority })
            }
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {action.type === 'snooze' && (
        <>
          <Field label="Snooze">
            <Select
              value={action.untilIso === null ? 'reply' : 'datetime'}
              onValueChange={(v) => setSnoozeUntil(v as 'reply' | 'datetime')}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reply">Until they reply</SelectItem>
                <SelectItem value="datetime">Until a date &amp; time</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {action.untilIso !== null && (
            <DateTimePicker
              value={new Date(action.untilIso)}
              minDate={new Date()}
              onChange={(d) => d && onChange({ ...action, untilIso: d.toISOString() })}
            />
          )}
        </>
      )}

      {action.type === 'apply_sla' && (
        <Field label="SLA policy">
          <Select
            value={action.policyId || undefined}
            onValueChange={(policyId) => onChange({ ...action, policyId })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Choose SLA policy" />
            </SelectTrigger>
            <SelectContent>
              {slaPolicies.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex flex-col items-start">
                    <span>{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.targetsSummary}</span>
                  </span>
                </SelectItem>
              ))}
              {/* A stored id that no longer resolves (archived / imported JSON)
                  stays selectable so the step doesn't render blank. */}
              {action.policyId && !slaPolicies.some((p) => p.id === action.policyId) && (
                <SelectItem value={action.policyId}>
                  <span className="font-mono text-xs">{action.policyId}</span>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>
      )}

      {action.type === 'set_attribute' && (
        <>
          <Field label="Attribute key">
            <Input
              value={action.key}
              onChange={(e) => onChange({ ...action, key: e.target.value })}
              placeholder="plan"
              className="h-8 text-sm"
            />
          </Field>
          <Field label="Value">
            <Input
              value={attributeValueText(action.value)}
              onChange={(e) => onChange({ ...action, value: parseAttributeValue(e.target.value) })}
              placeholder="vip"
              className="h-8 text-sm"
            />
          </Field>
        </>
      )}

      {action.type === 'close' && (
        <p className="text-xs text-muted-foreground">
          Closes the conversation and ends the run for this path.
        </p>
      )}
    </div>
  )
}

function WaitEditor({
  seconds,
  onChange,
}: {
  seconds: number
  onChange: (seconds: number) => void
}) {
  const { amount, unit } = secondsToWaitParts(seconds)
  const unitSeconds = (u: WaitUnit) => WAIT_UNITS.find((w) => w.value === u)!.seconds

  const setAmount = (raw: string) => {
    const n = Math.max(0, Math.round(Number(raw)))
    if (Number.isFinite(n)) onChange(n * unitSeconds(unit))
  }

  return (
    <div className="space-y-2">
      <Field label="Wait for">
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8 w-20 text-sm"
          />
          <Select value={unit} onValueChange={(u) => onChange(amount * unitSeconds(u as WaitUnit))}>
            <SelectTrigger size="sm" className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WAIT_UNITS.map((u) => (
                <SelectItem key={u.value} value={u.value}>
                  {u.plural}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Field>
      <p className="text-xs text-muted-foreground">
        The run pauses here, then continues. A reply or close ends the wait.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Condition editor: one level of "all/any of these rules". Nested groups are
// preserved untouched and pointed at JSON mode.
// ---------------------------------------------------------------------------

function ConditionEditor({
  subject,
  condition,
  onChange,
}: {
  subject: string
  condition: GraphCondition
  onChange: (condition: GraphCondition) => void
}) {
  const draft = conditionToDraft(condition)

  if (draft.kind === 'advanced') {
    return (
      <p className="text-xs text-muted-foreground">
        This condition nests groups the visual editor can&apos;t show. Use &quot;Edit as JSON&quot;
        to change it.
      </p>
    )
  }

  const commit = (next: SimpleConditionDraft) => onChange(draftToCondition(next))
  const updateRule = (index: number, rule: ConditionRuleDraft) =>
    commit({ ...draft, rules: draft.rules.map((r, i) => (i === index ? rule : r)) })

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{subject}</span>
        {draft.rules.length > 1 && (
          <>
            <Select
              value={draft.mode}
              onValueChange={(mode) => commit({ ...draft, mode: mode as 'all' | 'any' })}
            >
              <SelectTrigger size="xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="any">any</SelectItem>
              </SelectContent>
            </Select>
            <span>of these match</span>
          </>
        )}
      </div>

      {draft.rules.map((rule, i) => (
        <RuleRow
          key={i}
          rule={rule}
          onChange={(r) => updateRule(i, r)}
          onRemove={() => commit({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })}
        />
      ))}

      {draft.rules.length === 0 && (
        <p className="text-xs text-muted-foreground">No rules yet, so everything matches.</p>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => commit({ ...draft, rules: [...draft.rules, defaultRule()] })}
      >
        <PlusIcon className="size-3.5" /> Add rule
      </Button>
    </div>
  )
}

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: ConditionRuleDraft
  onChange: (rule: ConditionRuleDraft) => void
  onRemove: () => void
}) {
  const meta = CONDITION_FIELD_META[rule.field]
  const operators = OPERATORS_BY_KIND[meta.kind]
  const needsValue = !VALUELESS_OPERATORS.has(rule.op)

  const setField = (field: ConditionRuleDraft['field']) => {
    const fieldMeta = CONDITION_FIELD_META[field]
    const op = OPERATORS_BY_KIND[fieldMeta.kind][0]!
    const value =
      fieldMeta.kind === 'choice'
        ? (fieldMeta.options?.[0]?.value ?? '')
        : fieldMeta.kind === 'boolean'
          ? 'true'
          : ''
    onChange({ field, op, value })
  }

  const setOp = (op: ConditionOperator) =>
    onChange({ ...rule, op, value: VALUELESS_OPERATORS.has(op) ? '' : rule.value })

  return (
    <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
      <div className="flex items-center gap-1.5">
        <Select
          value={rule.field}
          onValueChange={(f) => setField(f as ConditionRuleDraft['field'])}
        >
          <SelectTrigger size="xs" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONDITION_FIELD_LIST.map((f) => (
              <SelectItem key={f} value={f}>
                {CONDITION_FIELD_META[f].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          aria-label="Remove rule"
          onClick={onRemove}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        >
          <XMarkIcon className="size-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <Select value={rule.op} onValueChange={(op) => setOp(op as ConditionOperator)}>
          <SelectTrigger
            size="xs"
            className={cn('min-w-0', needsValue ? 'w-32 shrink-0' : 'flex-1')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((op) => (
              <SelectItem key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {needsValue && <RuleValueEditor rule={rule} onChange={onChange} />}
      </div>
    </div>
  )
}

function RuleValueEditor({
  rule,
  onChange,
}: {
  rule: ConditionRuleDraft
  onChange: (rule: ConditionRuleDraft) => void
}) {
  const meta = CONDITION_FIELD_META[rule.field]
  const set = (value: string) => onChange({ ...rule, value })

  if (meta.kind === 'choice') {
    return (
      <Select value={rule.value} onValueChange={set}>
        <SelectTrigger size="xs" className="min-w-0 flex-1">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {(meta.options ?? []).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (meta.kind === 'boolean') {
    return (
      <Select value={rule.value || 'true'} onValueChange={set}>
        <SelectTrigger size="xs" className="min-w-0 flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    )
  }
  return (
    <Input
      type={meta.kind === 'number' ? 'number' : 'text'}
      value={rule.value}
      onChange={(e) => set(e.target.value)}
      placeholder={meta.placeholder}
      className="h-6 min-w-0 flex-1 px-1.5 text-xs"
    />
  )
}
