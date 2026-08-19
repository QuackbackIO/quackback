/**
 * Incident/maintenance editor (URL-driven modal, mirrors ChangelogModal's
 * layout): a lifecycle stepper + update composer + timeline in the main
 * column, an autosaving metadata sidebar, and ONE footer action whose label
 * states the transition ("Post update & mark as Monitoring").
 *
 * Separation rule: sidebar details autosave (debounced); the footer only
 * posts updates. Posting is the sole public, timeline-visible act.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Cog6ToothIcon, EnvelopeIcon } from '@heroicons/react/24/outline'
import type { StatusIncidentId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { TimeAgo } from '@/components/ui/time-ago'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ModalHeader } from '@/components/shared/modal-header'
import { ModalFooter } from '@/components/shared/modal-footer'
import { UrlModalShell } from '@/components/shared/url-modal-shell'
import { useUrlModal } from '@/lib/client/hooks/use-url-modal'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { useDebouncedSave } from '@/lib/client/hooks/use-debounced-save'
import { SidebarContainer, StatusSelect } from '@/components/shared/sidebar-primitives'
import { Route } from '@/routes/admin/status'
import { statusIncidentQueries, type StatusIncidentAdminDetail } from '@/lib/client/queries/status'
import { useUpdateStatusIncident, usePostStatusIncidentUpdate } from '@/lib/client/mutations/status'
import {
  AffectedComponentsField,
  TemplatePickerButton,
  type AffectedRow,
} from './status-incident-fields'
import { StatusLifecycleStepper } from './status-lifecycle-stepper'
import {
  IMPACT_COLORS,
  IMPACT_LABELS,
  LIFECYCLE_COLORS,
  LIFECYCLE_LABELS,
  isTerminalLifecycle,
  lifecycleValuesForKind,
  type StatusIncidentImpact,
  type StatusIncidentLifecycle,
} from './status-admin-colors'

const PINNABLE_IMPACTS = ['minor', 'major', 'critical'] as const

const impactPinOptions = PINNABLE_IMPACTS.map((value) => ({
  value,
  label: IMPACT_LABELS[value],
  color: IMPACT_COLORS[value],
}))

interface DetailsState {
  title: string
  impact: StatusIncidentImpact
  impactOverride: boolean
  affected: AffectedRow[]
  scheduledStart: Date | undefined
  scheduledEnd: Date | undefined
  autoStart: boolean
  autoComplete: boolean
}

function detailsFromIncident(incident: StatusIncidentAdminDetail): DetailsState {
  return {
    title: incident.title,
    impact:
      incident.impact === 'maintenance' || incident.impact === 'none' ? 'minor' : incident.impact,
    impactOverride: incident.impactOverride,
    affected: incident.affectedComponents.map((c) => ({
      componentId: c.componentId,
      componentStatus: c.componentStatus,
    })),
    scheduledStart: incident.scheduledStartAt ? new Date(incident.scheduledStartAt) : undefined,
    scheduledEnd: incident.scheduledEndAt ? new Date(incident.scheduledEndAt) : undefined,
    autoStart: incident.autoStart,
    autoComplete: incident.autoComplete,
  }
}

function formatDuration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const mins = Math.max(0, Math.round((end - start) / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function nextStage(
  kind: 'incident' | 'maintenance',
  current: StatusIncidentLifecycle
): StatusIncidentLifecycle {
  const stages = lifecycleValuesForKind(kind)
  const idx = stages.indexOf(current)
  return stages[Math.min(idx + 1, stages.length - 1)]
}

// ─── Editor ─────────────────────────────────────────────────────────────

function StatusIncidentEditorContent({
  incidentId,
  onClose,
}: {
  incidentId: StatusIncidentId
  onClose: () => void
}) {
  const { data: incident, isLoading } = useQuery(statusIncidentQueries.detail(incidentId))
  const updateMutation = useUpdateStatusIncident()
  const postMutation = usePostStatusIncidentUpdate()

  // ── Sidebar details: initialized once, then autosaved (debounced) ──
  const [details, setDetails] = useState<DetailsState | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)

  // ── Composer ──
  const [target, setTarget] = useState<StatusIncidentLifecycle | null>(null)
  const [body, setBody] = useState('')
  const [restore, setRestore] = useState(true)
  // Provenance: the template the composer inserted, if any. Rides along with
  // the posted update even if the operator rewrites the inserted text.
  const [templateId, setTemplateId] = useState<string | null>(null)

  useEffect(() => {
    if (incident && details === null) {
      setDetails(detailsFromIncident(incident))
      setTarget(nextStage(incident.kind, incident.status as StatusIncidentLifecycle))
    }
  }, [incident, details])

  const { mutateAsync: saveDetailsAsync } = updateMutation
  async function flushSave(next: DetailsState, kind: 'incident' | 'maintenance') {
    if (next.title.trim().length === 0 || next.affected.length === 0) return
    setSaveState('saving')
    try {
      await saveDetailsAsync({
        id: incidentId,
        title: next.title.trim(),
        ...(kind === 'incident'
          ? { impact: next.impact, impactOverride: next.impactOverride }
          : {}),
        affectedComponents: next.affected,
        ...(kind === 'maintenance'
          ? {
              scheduledStartAt: next.scheduledStart ?? null,
              scheduledEndAt: next.scheduledEnd ?? null,
              autoStart: next.autoStart,
              autoComplete: next.autoComplete,
            }
          : {}),
      })
      setSaveState('saved')
    } catch (error) {
      setSaveState('idle')
      toast.error(error instanceof Error ? error.message : 'Failed to save details')
    }
  }

  const kindRef = useRef<'incident' | 'maintenance'>('incident')
  if (incident) kindRef.current = incident.kind
  // Debounced autosave with flush-on-unmount (shared hook; same mechanism
  // as the status settings page's text fields).
  const detailsSave = useDebouncedSave<DetailsState>(
    (next) => void flushSave(next, kindRef.current),
    800
  )

  function patchDetails(patch: Partial<DetailsState>) {
    if (!incident) return
    setDetails((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      detailsSave.queue(next)
      return next
    })
  }

  // ── Post update ──
  const currentStatus = incident?.status as StatusIncidentLifecycle | undefined
  const effectiveTarget = target ?? currentStatus ?? 'investigating'
  const terminal = isTerminalLifecycle(effectiveTarget)

  async function handlePost() {
    if (!incident || !body.trim() || postMutation.isPending) return
    try {
      await postMutation.mutateAsync({
        id: incidentId,
        status: effectiveTarget,
        body: body.trim(),
        skipRestore: terminal ? !restore : undefined,
        ...(templateId ? { templateId } : {}),
      })
      setBody('')
      setRestore(true)
      setTemplateId(null)
      setTarget(nextStage(incident.kind, effectiveTarget))
      toast.success('Update posted')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to post update')
    }
  }

  const handleKeyDown = useKeyboardSubmit(handlePost)

  if (isLoading || !incident || !details) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const reachedAt: Partial<Record<StatusIncidentLifecycle, string>> = {}
  for (const u of incident.updates) {
    const s = u.status as StatusIncidentLifecycle
    if (!reachedAt[s]) reachedAt[s] = u.createdAt
  }

  const submitLabel = postMutation.isPending
    ? 'Posting…'
    : effectiveTarget === currentStatus
      ? 'Post update'
      : effectiveTarget === 'resolved'
        ? 'Post update & resolve'
        : effectiveTarget === 'completed'
          ? 'Post update & complete'
          : `Post update & mark as ${LIFECYCLE_LABELS[effectiveTarget]}`

  const sidebar = (
    <EditorSidebarContent
      incident={incident}
      details={details}
      onPatch={patchDetails}
      saveState={saveState}
    />
  )

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      <ModalHeader
        section={incident.kind === 'maintenance' ? 'Maintenance' : 'Incidents'}
        title={details.title || incident.title}
        onClose={onClose}
        viewUrl={`/status/${incidentId}`}
      />

      <div className="flex flex-1 min-h-0">
        {/* Main column: stepper + composer + timeline */}
        <div className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-7 py-6">
          <StatusLifecycleStepper
            kind={incident.kind}
            current={incident.status as StatusIncidentLifecycle}
            target={effectiveTarget}
            reachedAt={reachedAt}
            onSelect={setTarget}
            disabled={postMutation.isPending}
          />

          <div className="mt-6">
            <p className="text-xs text-muted-foreground mb-2">
              Posting as{' '}
              <span className="font-semibold" style={{ color: LIFECYCLE_COLORS[effectiveTarget] }}>
                {LIFECYCLE_LABELS[effectiveTarget]}
              </span>
              <span className="text-muted-foreground/60"> · click a step above to change</span>
            </p>
            <div className="rounded-xl border border-border/60 shadow-sm overflow-hidden focus-within:border-ring/50">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What's the latest? This appears on the public status page."
                className="min-h-24 border-0 shadow-none rounded-none focus-visible:ring-0 resize-y"
              />
              <div className="flex items-center gap-2 px-3 py-2 border-t border-border/40 bg-muted/30">
                <TemplatePickerButton
                  label="Insert template"
                  onApply={(t) => {
                    setBody((b) => (b ? `${b}\n\n${t.body}` : t.body))
                    setTemplateId(t.id)
                  }}
                />
                <div className="ml-auto">
                  {terminal && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Checkbox checked={restore} onCheckedChange={(c) => setRestore(c === true)} />
                      Restore affected services to operational
                    </label>
                  )}
                </div>
              </div>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground mt-2.5">
              <EnvelopeIcon className="h-3.5 w-3.5 mt-px shrink-0" />
              {incident.backfilled
                ? 'Backfilled incident: subscribers were never emailed.'
                : incident.notifiedAt
                  ? 'Subscribers were emailed once, when this was published. Updates appear on the status page and in-app.'
                  : 'Subscribers are emailed once at publish. Updates appear on the status page and in-app.'}
            </p>
          </div>

          <div className="mt-8">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-4">
              Timeline
            </h3>
            <IncidentTimeline incident={incident} />
          </div>
        </div>

        {/* Metadata sidebar (desktop) */}
        <SidebarContainer>{sidebar}</SidebarContainer>
      </div>

      <ModalFooter
        onCancel={onClose}
        submitLabel={submitLabel}
        isPending={postMutation.isPending}
        submitType="button"
        onSubmit={handlePost}
        submitDisabled={!body.trim()}
        hintAction="to post"
      >
        <Sheet open={mobileSettingsOpen} onOpenChange={setMobileSettingsOpen}>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="lg:hidden">
              <Cog6ToothIcon className="h-4 w-4 mr-1.5" />
              Details
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[70vh]">
            <SheetHeader>
              <SheetTitle>Incident details</SheetTitle>
            </SheetHeader>
            <div className="py-4 overflow-y-auto space-y-5">{sidebar}</div>
          </SheetContent>
        </Sheet>
      </ModalFooter>
    </div>
  )
}

// ─── Sidebar ────────────────────────────────────────────────────────────

function SideSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  )
}

function EditorSidebarContent({
  incident,
  details,
  onPatch,
  saveState,
}: {
  incident: StatusIncidentAdminDetail
  details: DetailsState
  onPatch: (patch: Partial<DetailsState>) => void
  saveState: 'idle' | 'saving' | 'saved'
}) {
  const lifecycle = incident.status as StatusIncidentLifecycle

  return (
    <>
      <SideSection label="Status">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{
            color: LIFECYCLE_COLORS[lifecycle],
            backgroundColor: `${LIFECYCLE_COLORS[lifecycle]}1a`,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: LIFECYCLE_COLORS[lifecycle] }}
          />
          {LIFECYCLE_LABELS[lifecycle]}
        </span>
        <p className="text-[11px] text-muted-foreground">Changes when you post an update.</p>
      </SideSection>

      {incident.kind === 'incident' && (
        <SideSection label="Impact">
          {details.impactOverride ? (
            <div className="space-y-1">
              <StatusSelect
                value={details.impact}
                options={impactPinOptions}
                onChange={(v) => onPatch({ impact: v as StatusIncidentImpact })}
              />
              <p className="text-[11px] text-muted-foreground">
                Pinned.{' '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() => onPatch({ impactOverride: false })}
                >
                  Derive from affected services instead
                </button>
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm">
                <span className="font-semibold">{IMPACT_LABELS[incident.impact]}</span>
                <span className="text-xs text-muted-foreground"> · derived</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                The worst affected service sets the impact.{' '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() => onPatch({ impactOverride: true })}
                >
                  Pin a different impact
                </button>
              </p>
            </div>
          )}
        </SideSection>
      )}

      {incident.kind === 'maintenance' && (
        <SideSection label="Window">
          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Scheduled start</Label>
              <DateTimePicker
                value={details.scheduledStart}
                onChange={(d) => onPatch({ scheduledStart: d })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Scheduled end</Label>
              <DateTimePicker
                value={details.scheduledEnd}
                onChange={(d) => onPatch({ scheduledEnd: d })}
              />
            </div>
            <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              Auto-start at scheduled time
              <Switch
                checked={details.autoStart}
                onCheckedChange={(c) => onPatch({ autoStart: c })}
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              Auto-complete at end time
              <Switch
                checked={details.autoComplete}
                onCheckedChange={(c) => onPatch({ autoComplete: c })}
              />
            </label>
          </div>
        </SideSection>
      )}

      <SideSection label="Affected services">
        <AffectedComponentsField
          kind={incident.kind}
          value={details.affected}
          onChange={(next) => onPatch({ affected: next })}
        />
        {details.affected.length === 0 && (
          <p className="text-[11px] text-destructive">
            Select at least one service. Changes are not saved until one is selected.
          </p>
        )}
      </SideSection>

      <SideSection label="Started">
        <p className="text-sm">
          <TimeAgo date={incident.startedAt} />
        </p>
        <p className="text-[11px] text-muted-foreground">
          {incident.resolvedAt
            ? `Lasted ${formatDuration(incident.startedAt, incident.resolvedAt)}`
            : `Ongoing for ${formatDuration(incident.startedAt, null)}`}
        </p>
      </SideSection>

      <SideSection label="Title">
        <Input
          value={details.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          className="h-8 text-sm"
        />
        {details.title.trim().length === 0 ? (
          <p className="text-[11px] text-destructive h-3.5">
            Add a title. Changes are not saved without one.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground h-3.5">
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'saved'
                ? 'Saved'
                : 'Details save automatically.'}
          </p>
        )}
      </SideSection>
    </>
  )
}

// ─── Timeline ───────────────────────────────────────────────────────────

function IncidentTimeline({ incident }: { incident: StatusIncidentAdminDetail }) {
  const updates = useMemo(
    () =>
      [...incident.updates].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [incident.updates]
  )
  const firstUpdateId = updates[updates.length - 1]?.id

  return (
    <div>
      {updates.map((u, i) => {
        const s = u.status as StatusIncidentLifecycle
        const isPublishRow = u.id === firstUpdateId
        return (
          <div key={u.id} className="relative flex gap-3 pb-6 last:pb-0">
            {i < updates.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[5px] top-4 bottom-0 w-0.5 rounded-full bg-border/80"
              />
            )}
            <span
              className="relative z-[1] mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-card"
              style={{ backgroundColor: LIFECYCLE_COLORS[s], boxShadow: '0 0 0 1px var(--border)' }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-semibold" style={{ color: LIFECYCLE_COLORS[s] }}>
                  {LIFECYCLE_LABELS[s]}
                </span>
                <TimeAgo date={u.createdAt} className="text-[11px] text-muted-foreground" />
              </div>
              <p className="text-sm text-foreground/90 mt-1 whitespace-pre-wrap">{u.body}</p>
              {isPublishRow && incident.notifiedAt && !incident.backfilled && (
                <span className="inline-flex items-center gap-1.5 mt-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <EnvelopeIcon className="h-3 w-3" />
                  Published
                  {typeof incident.notifiedSubscriberCount === 'number' &&
                    incident.notifiedSubscriberCount > 0 &&
                    ` · emailed ~${incident.notifiedSubscriberCount.toLocaleString()} subscribers`}
                </span>
              )}
              {isPublishRow && incident.backfilled && (
                <span className="inline-flex items-center gap-1.5 mt-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Backfilled · no emails sent
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── URL-modal wrapper ──────────────────────────────────────────────────

export function StatusIncidentModal({
  incidentId: urlIncidentId,
}: {
  incidentId: string | undefined
}) {
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
      {validatedId && <StatusIncidentEditorContent incidentId={validatedId} onClose={close} />}
    </UrlModalShell>
  )
}
