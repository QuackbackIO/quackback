import { useMemo, useState } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import {
  CalendarDaysIcon,
  EllipsisHorizontalIcon,
  MoonIcon,
  PauseIcon,
} from '@heroicons/react/24/outline'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { slaTargetsSummary } from '@/lib/shared/conversation/sla'
import {
  archiveSlaPolicyFn,
  createSlaPolicyFn,
  getSlaOfficeHoursFn,
  listSlaPoliciesFn,
  restoreSlaPolicyFn,
  updateSlaPolicyFn,
  type SlaPolicyDTO,
} from '@/lib/server/functions/sla'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const slaPoliciesQuery = queryOptions({
  queryKey: ['settings', 'slaPolicies'],
  queryFn: () => listSlaPoliciesFn(),
  staleTime: 30_000,
})

const slaOfficeHoursQuery = queryOptions({
  queryKey: ['settings', 'slaOfficeHours'],
  queryFn: () => getSlaOfficeHoursFn(),
  staleTime: 5 * 60 * 1000,
})

export const Route = createFileRoute('/admin/settings/sla')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({
      data: { allowedRoles: ['admin', 'member'], permission: PERMISSIONS.SLA_MANAGE },
    })
    await context.queryClient.ensureQueryData(slaPoliciesQuery)
    return {}
  },
  component: SlaSettingsRoute,
})

/** Gate behind the same experimental flag the rest of the Support area uses. */
function SlaSettingsRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/settings" />
  }
  return <SlaSettingsPage />
}

// ── Duration targets: integer + unit, stored as seconds ─────────────────────

type DurationUnit = 'm' | 'h' | 'd'
const UNIT_SECS: Record<DurationUnit, number> = { m: 60, h: 3600, d: 86400 }
const UNIT_LABELS: Record<DurationUnit, string> = { m: 'minutes', h: 'hours', d: 'days' }

interface DurationDraft {
  value: string
  unit: DurationUnit
}

/** Seconds → the largest exact unit, for editing ("14400" → 4 h). */
function toDraft(secs: number | null): DurationDraft {
  if (!secs) return { value: '', unit: 'h' }
  if (secs % 86400 === 0) return { value: String(secs / 86400), unit: 'd' }
  if (secs % 3600 === 0) return { value: String(secs / 3600), unit: 'h' }
  return { value: String(Math.max(1, Math.round(secs / 60))), unit: 'm' }
}

/** Draft → seconds; null = unset, undefined = invalid input. */
function toSecs(draft: DurationDraft): number | null | undefined {
  const raw = draft.value.trim()
  if (raw === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return undefined
  return n * UNIT_SECS[draft.unit]
}

const TARGET_FIELDS = [
  { key: 'firstResponseTargetSecs', label: 'First response' },
  { key: 'nextResponseTargetSecs', label: 'Next response' },
  { key: 'timeToCloseTargetSecs', label: 'Time to close' },
  { key: 'timeToResolveTargetSecs', label: 'Time to resolve' },
] as const
type TargetKey = (typeof TARGET_FIELDS)[number]['key']

// ── Page ─────────────────────────────────────────────────────────────────────

/** Which policy the editor dialog holds: a fresh one, a clone seed, or an edit. */
type EditorState =
  | { mode: 'create'; seed: SlaPolicyDTO | null }
  | { mode: 'edit'; policy: SlaPolicyDTO }
  | null

function SlaSettingsPage() {
  const queryClient = useQueryClient()
  const { data: policies } = useSuspenseQuery(slaPoliciesQuery)
  const { data: officeHours } = useQuery(slaOfficeHoursQuery)
  const officeHoursEnabled = officeHours?.officeHoursEnabled ?? false
  const [tab, setTab] = useState<'live' | 'archived'>('live')
  const [editor, setEditor] = useState<EditorState>(null)

  const live = useMemo(() => policies.filter((p) => !p.archivedAt), [policies])
  const archived = useMemo(() => policies.filter((p) => p.archivedAt), [policies])
  const rows = tab === 'live' ? live : archived

  const refresh = () => void queryClient.invalidateQueries({ queryKey: slaPoliciesQuery.queryKey })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveSlaPolicyFn({ data: { id } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(
          `In use by live ${result.workflows.length === 1 ? 'workflow' : 'workflows'}: ` +
            `${result.workflows.map((w) => w.name).join(', ')}. Pause or edit them first.`
        )
        return
      }
      toast.success('Policy archived')
      refresh()
    },
    onError: () => toast.error('Failed to archive policy'),
  })

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreSlaPolicyFn({ data: { id } }),
    onSuccess: () => {
      toast.success('Policy restored')
      refresh()
    },
    onError: () => toast.error('Failed to restore policy'),
  })

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ShieldCheckIcon}
        title="SLA policies"
        description="Response and resolution targets your team commits to. Apply them to conversations from workflows."
      />

      <SettingsCard
        title="Policies"
        description="Live policies can be applied by workflows; archived ones keep their history."
        action={
          <Button type="button" size="sm" onClick={() => setEditor({ mode: 'create', seed: null })}>
            New policy
          </Button>
        }
        contentClassName="p-0 sm:p-0"
      >
        <div className="flex gap-1 border-b border-border/50 px-4 pt-2 sm:px-6">
          {(
            [
              { id: 'live', label: `Live${live.length ? ` (${live.length})` : ''}` },
              {
                id: 'archived',
                label: `Archived${archived.length ? ` (${archived.length})` : ''}`,
              },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                tab === t.id
                  ? 'border-b-2 border-primary px-2 pb-2 text-sm font-medium text-foreground'
                  : 'border-b-2 border-transparent px-2 pb-2 text-sm text-muted-foreground hover:text-foreground'
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-6">
            {tab === 'live'
              ? 'No SLA policies yet. Create one, then apply it from a workflow.'
              : 'No archived policies.'}
          </p>
        ) : (
          <div className="divide-y divide-border/40">
            {rows.map((p) => (
              <PolicyRow
                key={p.id}
                policy={p}
                officeHoursEnabled={officeHoursEnabled}
                onEdit={() => setEditor({ mode: 'edit', policy: p })}
                onClone={() => setEditor({ mode: 'create', seed: p })}
                onArchive={() => archiveMutation.mutate(p.id)}
                onRestore={() => restoreMutation.mutate(p.id)}
              />
            ))}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="How SLAs apply"
        description="The rules the clock engine follows once a policy is on a conversation."
      >
        <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
          <li>
            Policies are applied by workflows only, through the Apply SLA action. There is no
            default policy and nothing is matched automatically.
          </li>
          <li>
            A conversation carries one active SLA. Applying another policy replaces it and restarts
            the reply clocks; re-applying the same policy keeps the elapsed time.
          </li>
          <li>
            Targets are snapshotted at apply time. Editing a policy affects future applications
            only, never clocks already running.
          </li>
          <li>
            Clocks count only your workspace office hours when they are configured; otherwise they
            run around the clock.
          </li>
          <li>
            Archived policies can no longer be applied, but they stay on conversations that already
            carry them and in reports.
          </li>
        </ul>
      </SettingsCard>

      {editor && (
        <PolicyEditorDialog
          key={editor.mode === 'edit' ? editor.policy.id : (editor.seed?.id ?? 'new')}
          editor={editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function PolicyRow({
  policy,
  officeHoursEnabled,
  onEdit,
  onClone,
  onArchive,
  onRestore,
}: {
  policy: SlaPolicyDTO
  officeHoursEnabled: boolean
  onEdit: () => void
  onClone: () => void
  onArchive: () => void
  onRestore: () => void
}) {
  const isArchived = !!policy.archivedAt
  const usedBy = policy.usedByWorkflows
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{policy.name}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <CalendarDaysIcon className="h-3 w-3" aria-hidden />
            {officeHoursEnabled ? 'Office hours' : '24/7'}
          </span>
          {policy.pauseOnSnooze && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              <MoonIcon className="h-3 w-3" aria-hidden />
              Pauses on snooze
            </span>
          )}
          {/* Only shown when the ticket clock exists — the flag is inert otherwise. */}
          {policy.pauseOnPending && policy.timeToResolveTargetSecs && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              <PauseIcon className="h-3 w-3" aria-hidden />
              Pauses while pending
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{slaTargetsSummary(policy)}</p>
        {usedBy.length > 0 && (
          <p
            className="mt-0.5 cursor-default text-[11px] text-muted-foreground/80 underline decoration-dotted underline-offset-2"
            title={usedBy.map((w) => `${w.name} (${w.status})`).join('\n')}
          >
            Used by {usedBy.length} {usedBy.length === 1 ? 'workflow' : 'workflows'}
          </p>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${policy.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <EllipsisHorizontalIcon className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isArchived ? (
            <DropdownMenuItem onClick={onRestore}>Restore</DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={onClone}>Clone</DropdownMenuItem>
              <DropdownMenuItem onClick={onArchive} className="text-destructive">
                Archive
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ── Editor dialog ────────────────────────────────────────────────────────────

function PolicyEditorDialog({
  editor,
  onClose,
  onSaved,
}: {
  editor: NonNullable<EditorState>
  onClose: () => void
  onSaved: () => void
}) {
  const editing = editor.mode === 'edit' ? editor.policy : null
  const seed = editor.mode === 'create' ? editor.seed : editing

  const [name, setName] = useState(
    editor.mode === 'create' && editor.seed ? `${editor.seed.name} (copy)` : (seed?.name ?? '')
  )
  const [targets, setTargets] = useState<Record<TargetKey, DurationDraft>>({
    firstResponseTargetSecs: toDraft(seed?.firstResponseTargetSecs ?? null),
    nextResponseTargetSecs: toDraft(seed?.nextResponseTargetSecs ?? null),
    timeToCloseTargetSecs: toDraft(seed?.timeToCloseTargetSecs ?? null),
    timeToResolveTargetSecs: toDraft(seed?.timeToResolveTargetSecs ?? null),
  })
  const [pauseOnSnooze, setPauseOnSnooze] = useState(seed?.pauseOnSnooze ?? true)
  const [pauseOnPending, setPauseOnPending] = useState(seed?.pauseOnPending ?? true)
  const [error, setError] = useState<string | null>(null)

  const { data: officeHours } = useQuery(slaOfficeHoursQuery)
  const officeHoursEnabled = officeHours?.officeHoursEnabled ?? false

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = {} as Record<TargetKey, number | null>
      for (const field of TARGET_FIELDS) {
        const secs = toSecs(targets[field.key])
        if (secs === undefined) throw new EditorError(`${field.label}: enter a whole number`)
        // Targets may be added or changed, never removed once set (the server
        // enforces the same rule).
        if (editing && editing[field.key] != null && secs === null) {
          throw new EditorError('Targets can be changed but not removed once set')
        }
        parsed[field.key] = secs
      }
      if (!name.trim()) throw new EditorError('Give the policy a name')
      if (Object.values(parsed).every((v) => v === null)) {
        throw new EditorError('Set at least one target')
      }
      const payload = {
        name: name.trim(),
        ...parsed,
        pauseOnSnooze,
        pauseOnPending,
      }
      if (editing) {
        const result = await updateSlaPolicyFn({ data: { id: editing.id, ...payload } })
        if (!result.ok) throw new EditorError(result.message)
        return
      }
      await createSlaPolicyFn({ data: payload })
    },
    onSuccess: () => {
      toast.success(editing ? 'Policy updated' : 'Policy created')
      onSaved()
    },
    onError: (err) => {
      if (err instanceof EditorError) setError(err.message)
      else toast.error('Failed to save policy')
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit SLA policy' : 'New SLA policy'}</DialogTitle>
          <DialogDescription>
            Response targets count from the customer&apos;s message; the resolve target clocks the
            linked ticket to a resolved status. Leave a target empty to skip it; at least one is
            required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sla-policy-name">Name</Label>
            <Input
              id="sla-policy-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Premium support"
              maxLength={120}
            />
          </div>

          <div className="space-y-2.5">
            {TARGET_FIELDS.map((field) => {
              const draft = targets[field.key]
              const locked = !!editing && editing[field.key] != null
              return (
                <div key={field.key} className="flex items-center gap-2">
                  <Label htmlFor={`sla-${field.key}`} className="w-28 shrink-0 text-xs">
                    {field.label}
                  </Label>
                  <Input
                    id={`sla-${field.key}`}
                    type="number"
                    min={1}
                    step={1}
                    value={draft.value}
                    onChange={(e) =>
                      setTargets((t) => ({
                        ...t,
                        [field.key]: { ...draft, value: e.target.value },
                      }))
                    }
                    placeholder={locked ? undefined : 'Off'}
                    className="h-8 w-24 text-sm"
                  />
                  <Select
                    value={draft.unit}
                    onValueChange={(unit) =>
                      setTargets((t) => ({
                        ...t,
                        [field.key]: { ...draft, unit: unit as DurationUnit },
                      }))
                    }
                  >
                    <SelectTrigger size="sm" className="w-28" aria-label={`${field.label} unit`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(UNIT_SECS) as DurationUnit[]).map((u) => (
                        <SelectItem key={u} value={u}>
                          {UNIT_LABELS[u]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            })}
            {editing && (
              <p className="text-[11px] text-muted-foreground">
                Targets can be changed but not removed once set. Edits only affect conversations the
                policy is applied to afterwards.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between py-1">
            <div className="pr-4">
              <Label htmlFor="sla-pause-on-snooze" className="text-sm font-medium cursor-pointer">
                Pause while snoozed
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Stop the clocks while the conversation is snoozed.
              </p>
            </div>
            <Switch
              id="sla-pause-on-snooze"
              checked={pauseOnSnooze}
              onCheckedChange={setPauseOnSnooze}
            />
          </div>

          <div className="flex items-center justify-between py-1">
            <div className="pr-4">
              <Label htmlFor="sla-pause-on-pending" className="text-sm font-medium cursor-pointer">
                Pause while pending
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Stop a ticket&apos;s resolve clock while it waits in a pending status (on the
                customer or a third party).
              </p>
            </div>
            <Switch
              id="sla-pause-on-pending"
              checked={pauseOnPending}
              onCheckedChange={setPauseOnPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Business hours</Label>
            <p className="text-xs text-muted-foreground">
              {officeHoursEnabled
                ? 'Clocks count only time inside your workspace office hours.'
                : 'Clocks run around the clock. Set office hours in Settings to make clocks count only open time.'}
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              setError(null)
              saveMutation.mutate()
            }}
            disabled={saveMutation.isPending}
          >
            {editing ? 'Save changes' : 'Create policy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Validation errors surfaced inline in the dialog (vs. an error toast). */
class EditorError extends Error {}
