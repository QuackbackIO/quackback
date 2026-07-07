import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { PlusIcon } from '@heroicons/react/24/solid'
import { Loader2 } from 'lucide-react'
import type { StatusIncidentId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ModalHeader } from '@/components/shared/modal-header'
import { UrlModalShell } from '@/components/shared/url-modal-shell'
import { useUrlModal } from '@/lib/client/hooks/use-url-modal'
import { StatusSelect, type StatusOption } from '@/components/shared/sidebar-primitives'
import { Route } from '@/routes/admin/status'
import {
  statusComponentQueries,
  statusIncidentQueries,
  statusTemplateQueries,
  type StatusComponentsAdmin,
} from '@/lib/client/queries/status'
import {
  useCreateStatusIncident,
  useUpdateStatusIncident,
  usePostStatusIncidentUpdate,
} from '@/lib/client/mutations/status'
import {
  COMPONENT_STATUS_OPTIONS,
  IMPACT_LABELS,
  LIFECYCLE_LABELS,
  defaultAffectedStatus,
  isTerminalLifecycle,
  lifecycleOptionsForKind,
  type StatusComponentStatus,
  type StatusIncidentImpact,
  type StatusIncidentKind,
  type StatusIncidentLifecycle,
} from './status-admin-colors'

interface AffectedRow {
  componentId: string
  componentStatus: StatusComponentStatus
}

interface FlatComponent {
  id: string
  name: string
  groupName: string | null
}

function flattenComponents(data: StatusComponentsAdmin | undefined): FlatComponent[] {
  if (!data) return []
  const flat: FlatComponent[] = []
  for (const group of data.groups) {
    for (const c of group.components) flat.push({ id: c.id, name: c.name, groupName: group.name })
  }
  for (const c of data.ungrouped) flat.push({ id: c.id, name: c.name, groupName: null })
  return flat
}

const componentStatusOptionsFor = (): readonly StatusOption[] => COMPONENT_STATUS_OPTIONS

/** Checklist of components with an inline colored status picker for each
 *  checked row — shared by the create dialog and the edit modal. */
function AffectedComponentsField({
  kind,
  value,
  onChange,
}: {
  kind: StatusIncidentKind
  value: AffectedRow[]
  onChange: (next: AffectedRow[]) => void
}) {
  const { data, isLoading } = useQuery(statusComponentQueries.list())
  const components = useMemo(() => flattenComponents(data), [data])
  const byId = useMemo(() => new Map(value.map((v) => [v.componentId, v.componentStatus])), [value])

  function toggle(id: string) {
    if (byId.has(id)) {
      onChange(value.filter((v) => v.componentId !== id))
    } else {
      onChange([...value, { componentId: id, componentStatus: defaultAffectedStatus(kind) }])
    }
  }

  function setStatus(id: string, status: StatusComponentStatus) {
    onChange(value.map((v) => (v.componentId === id ? { ...v, componentStatus: status } : v)))
  }

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading components…</p>
  if (components.length === 0) {
    return <p className="text-xs text-muted-foreground">No components yet — create one first.</p>
  }

  return (
    <div className="space-y-1 rounded-lg border border-border/50">
      {components.map((c) => {
        const status = byId.get(c.id)
        const checked = status !== undefined
        return (
          <div
            key={c.id}
            className="flex items-center gap-3 border-b border-border/40 px-3 py-2 last:border-b-0"
          >
            <Checkbox checked={checked} onCheckedChange={() => toggle(c.id)} />
            <span className="flex-1 min-w-0 truncate text-sm">
              {c.name}
              {c.groupName && (
                <span className="ml-1.5 text-xs text-muted-foreground">· {c.groupName}</span>
              )}
            </span>
            {checked && (
              <StatusSelect
                value={status}
                options={componentStatusOptionsFor()}
                onChange={(v) => setStatus(c.id, v as StatusComponentStatus)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function TemplatePickerSelect({
  onApply,
}: {
  onApply: (template: {
    title: string
    body: string
    impact: StatusIncidentImpact
    componentIds: string[]
  }) => void
}) {
  const { data: templates } = useQuery(statusTemplateQueries.list())
  if (!templates || templates.length === 0) return null

  return (
    <Select
      onValueChange={(id) => {
        const t = templates.find((tpl) => tpl.id === id)
        if (t) onApply(t)
      }}
    >
      <SelectTrigger className="w-52">
        <SelectValue placeholder="Apply a template…" />
      </SelectTrigger>
      <SelectContent>
        {templates.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function impactOptions(): readonly StatusOption[] {
  return (['minor', 'major', 'critical'] as const).map((value) => ({
    value,
    label: IMPACT_LABELS[value],
    color: '#f59e0b',
  }))
}

// ─── Create ─────────────────────────────────────────────────────────────

interface CreateStatusIncidentDialogProps {
  kind: StatusIncidentKind
}

export function CreateStatusIncidentDialog({ kind }: CreateStatusIncidentDialogProps) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const createMutation = useCreateStatusIncident()
  const lifecycleOptions = lifecycleOptionsForKind(kind)

  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<StatusIncidentLifecycle>(lifecycleOptions[0].value)
  const [impact, setImpact] = useState<StatusIncidentImpact>('minor')
  const [impactOverride, setImpactOverride] = useState(false)
  const [affected, setAffected] = useState<AffectedRow[]>([])
  const [body, setBody] = useState('')
  const [notify, setNotify] = useState(true)
  const [backfill, setBackfill] = useState(false)
  const [backfillStart, setBackfillStart] = useState<Date | undefined>(undefined)
  const [backfillEnd, setBackfillEnd] = useState<Date | undefined>(undefined)
  const [scheduledStart, setScheduledStart] = useState<Date | undefined>(undefined)
  const [scheduledEnd, setScheduledEnd] = useState<Date | undefined>(undefined)
  const [autoStart, setAutoStart] = useState(true)
  const [autoComplete, setAutoComplete] = useState(true)

  function reset() {
    setTitle('')
    setStatus(lifecycleOptions[0].value)
    setImpact('minor')
    setImpactOverride(false)
    setAffected([])
    setBody('')
    setNotify(true)
    setBackfill(false)
    setBackfillStart(undefined)
    setBackfillEnd(undefined)
    setScheduledStart(undefined)
    setScheduledEnd(undefined)
    setAutoStart(true)
    setAutoComplete(true)
    createMutation.reset()
  }

  function applyTemplate(t: {
    title: string
    body: string
    impact: StatusIncidentImpact
    componentIds: string[]
  }) {
    setTitle(t.title)
    setBody(t.body)
    if (kind === 'incident') {
      setImpact(t.impact)
      setImpactOverride(true)
    }
    setAffected(
      t.componentIds.map((id) => ({
        componentId: id,
        componentStatus: defaultAffectedStatus(kind),
      }))
    )
  }

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && affected.length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    try {
      const created = await createMutation.mutateAsync({
        kind,
        title: title.trim(),
        status,
        ...(kind === 'incident' ? { impact, impactOverride } : {}),
        affectedComponents: affected,
        body: body.trim(),
        ...(kind === 'maintenance'
          ? {
              scheduledStartAt: scheduledStart ?? null,
              scheduledEndAt: scheduledEnd ?? null,
              autoStart,
              autoComplete,
            }
          : {}),
        ...(backfill && backfillStart && backfillEnd
          ? {
              backfill: { startedAt: backfillStart, resolvedAt: backfillEnd },
              notifySubscribers: false,
            }
          : { notifySubscribers: notify }),
      })
      setOpen(false)
      reset()
      void navigate({
        to: '/admin/status',
        search: {
          ...search,
          view: kind === 'maintenance' ? 'maintenance' : 'open',
          incident: created.id,
        },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        {kind === 'maintenance' ? (
          <Button variant="outline" size="sm">
            Schedule maintenance
          </Button>
        ) : (
          <Button size="sm">
            <PlusIcon className="h-4 w-4 mr-1.5" />
            New incident
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {kind === 'maintenance' ? 'Schedule maintenance' : 'New incident'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="incident-title">Title</Label>
              <Input
                id="incident-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  kind === 'maintenance' ? 'Database maintenance window' : "What's happening?"
                }
                required
                autoFocus
              />
            </div>
            <TemplatePickerSelect onApply={applyTemplate} />
          </div>

          <div className="flex items-center gap-6">
            <div className="space-y-2">
              <Label>Status</Label>
              <StatusSelect
                value={status}
                options={lifecycleOptions}
                onChange={(v) => setStatus(v as StatusIncidentLifecycle)}
              />
            </div>
            {kind === 'incident' && (
              <div className="flex items-center gap-2">
                <Switch checked={impactOverride} onCheckedChange={setImpactOverride} />
                <Label className="text-xs text-muted-foreground">Override impact</Label>
                {impactOverride && (
                  <StatusSelect
                    value={impact}
                    options={impactOptions()}
                    onChange={(v) => setImpact(v as StatusIncidentImpact)}
                  />
                )}
              </div>
            )}
          </div>

          {kind === 'maintenance' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Scheduled start</Label>
                <DateTimePicker
                  value={scheduledStart}
                  onChange={setScheduledStart}
                  minDate={new Date()}
                />
              </div>
              <div className="space-y-2">
                <Label>Scheduled end</Label>
                <DateTimePicker
                  value={scheduledEnd}
                  onChange={setScheduledEnd}
                  minDate={scheduledStart}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={autoStart} onCheckedChange={setAutoStart} />
                <Label className="text-xs text-muted-foreground">
                  Auto-start at scheduled time
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={autoComplete} onCheckedChange={setAutoComplete} />
                <Label className="text-xs text-muted-foreground">Auto-complete at end time</Label>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Affected components</Label>
            <AffectedComponentsField kind={kind} value={affected} onChange={setAffected} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="incident-body">First update</Label>
            <Textarea
              id="incident-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share what's happening and what you're doing about it…"
              className="min-h-24"
              required
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <div>
              <Label className="text-sm">Backfill (already resolved)</Label>
              <p className="text-xs text-muted-foreground">
                Create this already resolved with historical timestamps. Disables notifications.
              </p>
            </div>
            <Switch checked={backfill} onCheckedChange={setBackfill} />
          </div>

          {backfill ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Started at</Label>
                <DateTimePicker
                  value={backfillStart}
                  onChange={setBackfillStart}
                  maxDate={new Date()}
                />
              </div>
              <div className="space-y-2">
                <Label>Resolved at</Label>
                <DateTimePicker
                  value={backfillEnd}
                  onChange={setBackfillEnd}
                  maxDate={new Date()}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Checkbox checked={notify} onCheckedChange={(c) => setNotify(c === true)} />
              <Label className="text-xs text-muted-foreground">
                Email subscribers (applies once, when this is published)
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || createMutation.isPending}>
              {createMutation.isPending
                ? 'Creating…'
                : kind === 'maintenance'
                  ? 'Schedule maintenance'
                  : 'Publish incident'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit / view (URL-driven, mirrors ChangelogModal) ───────────────────

interface StatusIncidentModalContentProps {
  incidentId: StatusIncidentId
  onClose: () => void
}

function StatusIncidentModalContent({ incidentId, onClose }: StatusIncidentModalContentProps) {
  const { data: incident, isLoading } = useQuery(statusIncidentQueries.detail(incidentId))
  const updateMutation = useUpdateStatusIncident()
  const postUpdateMutation = usePostStatusIncidentUpdate()

  const [title, setTitle] = useState('')
  const [impact, setImpact] = useState<StatusIncidentImpact>('minor')
  const [impactOverride, setImpactOverride] = useState(false)
  const [affected, setAffected] = useState<AffectedRow[]>([])
  const [scheduledStart, setScheduledStart] = useState<Date | undefined>(undefined)
  const [scheduledEnd, setScheduledEnd] = useState<Date | undefined>(undefined)
  const [autoStart, setAutoStart] = useState(true)
  const [autoComplete, setAutoComplete] = useState(true)
  const [hasInitialized, setHasInitialized] = useState(false)

  const [newStatus, setNewStatus] = useState<StatusIncidentLifecycle>('investigating')
  const [updateBody, setUpdateBody] = useState('')
  const [skipRestore, setSkipRestore] = useState(false)

  useEffect(() => {
    if (incident && !hasInitialized) {
      setTitle(incident.title)
      setImpact(
        incident.impact === 'maintenance' || incident.impact === 'none' ? 'minor' : incident.impact
      )
      setImpactOverride(incident.impactOverride)
      setAffected(
        incident.affectedComponents.map((c) => ({
          componentId: c.componentId,
          componentStatus: c.componentStatus,
        }))
      )
      setScheduledStart(incident.scheduledStartAt ? new Date(incident.scheduledStartAt) : undefined)
      setScheduledEnd(incident.scheduledEndAt ? new Date(incident.scheduledEndAt) : undefined)
      setAutoStart(incident.autoStart)
      setAutoComplete(incident.autoComplete)
      setNewStatus(incident.status as StatusIncidentLifecycle)
      setHasInitialized(true)
    }
  }, [incident, hasInitialized])

  if (isLoading || !incident) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const lifecycleOptions = lifecycleOptionsForKind(incident.kind)
  const terminal = isTerminalLifecycle(newStatus)

  async function handleSaveDetails() {
    try {
      await updateMutation.mutateAsync({
        id: incidentId,
        title: title.trim(),
        ...(incident?.kind === 'incident' ? { impact, impactOverride } : {}),
        affectedComponents: affected,
        ...(incident?.kind === 'maintenance'
          ? {
              scheduledStartAt: scheduledStart ?? null,
              scheduledEndAt: scheduledEnd ?? null,
              autoStart,
              autoComplete,
            }
          : {}),
      })
      toast.success('Details saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save')
    }
  }

  async function handlePostUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!updateBody.trim()) return
    try {
      await postUpdateMutation.mutateAsync({
        id: incidentId,
        status: newStatus,
        body: updateBody.trim(),
        skipRestore: terminal ? skipRestore : undefined,
      })
      setUpdateBody('')
      setSkipRestore(false)
      toast.success('Update posted')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to post update')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <ModalHeader
        section={incident.kind === 'maintenance' ? 'Maintenance' : 'Incident'}
        title={incident.title}
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">
            {incident.kind === 'maintenance' ? 'Maintenance' : 'Incident'}
          </Badge>
          <Badge variant="outline">
            {LIFECYCLE_LABELS[incident.status as StatusIncidentLifecycle]}
          </Badge>
          <Badge variant="outline">{IMPACT_LABELS[incident.impact]}</Badge>
          <span>
            Started <TimeAgo date={incident.startedAt} />
          </span>
        </div>

        <section className="space-y-3 rounded-lg border border-border/50 p-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          {incident.kind === 'incident' && (
            <div className="flex items-center gap-2">
              <Switch checked={impactOverride} onCheckedChange={setImpactOverride} />
              <Label className="text-xs text-muted-foreground">Override impact</Label>
              {impactOverride && (
                <StatusSelect
                  value={impact}
                  options={impactOptions()}
                  onChange={(v) => setImpact(v as StatusIncidentImpact)}
                />
              )}
            </div>
          )}

          {incident.kind === 'maintenance' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Scheduled start</Label>
                <DateTimePicker value={scheduledStart} onChange={setScheduledStart} />
              </div>
              <div className="space-y-2">
                <Label>Scheduled end</Label>
                <DateTimePicker value={scheduledEnd} onChange={setScheduledEnd} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={autoStart} onCheckedChange={setAutoStart} />
                <Label className="text-xs text-muted-foreground">Auto-start</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={autoComplete} onCheckedChange={setAutoComplete} />
                <Label className="text-xs text-muted-foreground">Auto-complete</Label>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Affected components</Label>
            <AffectedComponentsField kind={incident.kind} value={affected} onChange={setAffected} />
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={handleSaveDetails}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Update timeline</h3>
          <div className="space-y-3">
            {[...incident.updates]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((u) => (
                <div key={u.id} className="flex gap-3 text-sm">
                  <Badge variant="outline" className="shrink-0">
                    {LIFECYCLE_LABELS[u.status as StatusIncidentLifecycle]}
                  </Badge>
                  <p className="flex-1 text-muted-foreground">{u.body}</p>
                  <TimeAgo date={u.createdAt} className="shrink-0 text-xs text-muted-foreground" />
                </div>
              ))}
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-border/50 p-4">
          <h3 className="text-sm font-semibold">Post update</h3>
          <form onSubmit={handlePostUpdate} className="space-y-3">
            <StatusSelect
              value={newStatus}
              options={lifecycleOptions}
              onChange={(v) => setNewStatus(v as StatusIncidentLifecycle)}
            />
            <Textarea
              value={updateBody}
              onChange={(e) => setUpdateBody(e.target.value)}
              placeholder="What's the latest?"
              className="min-h-20"
              required
            />
            {terminal && (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={skipRestore}
                  onCheckedChange={(c) => setSkipRestore(c === true)}
                />
                <Label className="text-xs text-muted-foreground">
                  Don&apos;t restore affected components to operational (partial recovery)
                </Label>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Updates never email subscribers.</p>
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={!updateBody.trim() || postUpdateMutation.isPending}
              >
                {postUpdateMutation.isPending ? 'Posting…' : 'Post update'}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}

interface StatusIncidentModalProps {
  incidentId: string | undefined
}

export function StatusIncidentModal({ incidentId: urlIncidentId }: StatusIncidentModalProps) {
  const search = Route.useSearch()
  const { open, validatedId, close } = useUrlModal<StatusIncidentId>({
    urlId: urlIncidentId,
    idPrefix: 'status_incident',
    searchParam: 'incident',
    route: '/admin/status',
    search,
  })

  return (
    <UrlModalShell
      open={open}
      onOpenChange={(o) => !o && close()}
      srTitle="Status incident"
      hasValidId={!!validatedId}
    >
      {validatedId && <StatusIncidentModalContent incidentId={validatedId} onClose={close} />}
    </UrlModalShell>
  )
}
