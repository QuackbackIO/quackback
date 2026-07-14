/**
 * Report an incident — the fast path: title, what's happening, affected
 * services. Impact is derived from the worst affected service and shown as
 * a read-only note (pin it later in the editor if needed); the notify line
 * states exactly what one email at publish means.
 *
 * Backfill is an explicit MODE ("Log a past incident instead") that
 * reframes the whole dialog, not a toggle that silently rewires the form:
 * historical timestamps appear, notify disappears (backfills never email,
 * enforced server-side), and the incident is created already resolved.
 */
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { PlusIcon } from '@heroicons/react/24/solid'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Route } from '@/routes/admin/status'
import { useCreateStatusIncident } from '@/lib/client/mutations/status'
import {
  AffectedComponentsField,
  TemplatePickerButton,
  templateToAffectedRows,
  type AffectedRow,
} from './status-incident-fields'
import { deriveImpact } from '@/lib/shared/status-calc'
import { IMPACT_LABELS, type StatusIncidentImpact } from './status-admin-colors'

export function ReportIncidentDialog({ variant = 'default' }: { variant?: 'default' | 'outline' }) {
  const [open, setOpen] = useState(false)
  const [backfill, setBackfill] = useState(false)
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const createMutation = useCreateStatusIncident()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [affected, setAffected] = useState<AffectedRow[]>([])
  // A template's configured impact applies as a pin (impactOverride) —
  // otherwise the template's pre-classified severity would be silently
  // dropped in favor of the derived value.
  const [templateImpact, setTemplateImpact] = useState<StatusIncidentImpact | null>(null)
  // Provenance: which template seeded this report, if any. Survives later edits
  // to the text — applying a template then rewriting still counts as a use.
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [notify, setNotify] = useState(true)
  const [backfillStart, setBackfillStart] = useState<Date | undefined>(undefined)
  const [backfillEnd, setBackfillEnd] = useState<Date | undefined>(undefined)

  function reset() {
    setBackfill(false)
    setTitle('')
    setBody('')
    setAffected([])
    setTemplateImpact(null)
    setTemplateId(null)
    setNotify(true)
    setBackfillStart(undefined)
    setBackfillEnd(undefined)
    createMutation.reset()
  }

  const derivedImpact = deriveImpact(affected.map((a) => a.componentStatus))
  const effectiveImpact = templateImpact ?? derivedImpact
  const canSubmit =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    affected.length > 0 &&
    (!backfill || (!!backfillStart && !!backfillEnd))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    try {
      const created = await createMutation.mutateAsync({
        kind: 'incident',
        title: title.trim(),
        status: backfill ? 'resolved' : 'investigating',
        ...(templateImpact ? { impact: templateImpact, impactOverride: true } : {}),
        ...(templateId ? { templateId } : {}),
        affectedComponents: affected,
        body: body.trim(),
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
        search: { ...search, view: 'open', incident: created.id },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to report incident')
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
        <Button size="sm" variant={variant}>
          <PlusIcon className="h-4 w-4 mr-1.5" />
          Report incident
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{backfill ? 'Log a past incident' : 'Report an incident'}</DialogTitle>
          <DialogDescription>
            {backfill
              ? 'Adds to incident history and uptime. Subscribers are not emailed.'
              : 'Publishes to your status page and emails subscribers once.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="report-title">Title</Label>
              <TemplatePickerButton
                label="Start from template"
                onApply={(t) => {
                  setTitle(t.title)
                  setBody(t.body)
                  setAffected(templateToAffectedRows(t.componentIds, 'incident'))
                  setTemplateId(t.id)
                  setTemplateImpact(
                    t.impact === 'minor' || t.impact === 'major' || t.impact === 'critical'
                      ? t.impact
                      : null
                  )
                }}
              />
            </div>
            <Input
              id="report-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Elevated error rates on the API"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="report-body">What's happening?</Label>
            <Textarea
              id="report-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share what's happening and what you're doing about it…"
              className="min-h-24"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Affected services</Label>
            <AffectedComponentsField kind="incident" value={affected} onChange={setAffected} />
          </div>

          {affected.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <ExclamationTriangleIcon className="h-3.5 w-3.5 shrink-0" />
              <span>
                Impact:{' '}
                <span className="font-semibold text-foreground">
                  {IMPACT_LABELS[effectiveImpact]}
                </span>{' '}
                {templateImpact
                  ? '· pinned by the applied template. You can change it after publishing.'
                  : '· derived from the worst affected service. You can pin it after publishing.'}
              </span>
            </div>
          )}

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
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={notify}
                onCheckedChange={(c) => setNotify(c === true)}
                className="mt-0.5"
              />
              <span className="text-sm">
                Email subscribers
                <span className="block text-xs text-muted-foreground">
                  One email at publish. Updates and the resolve never email.
                </span>
              </span>
            </label>
          )}

          <DialogFooter className="sm:justify-between gap-2">
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground text-left"
              onClick={() => setBackfill((b) => !b)}
            >
              {backfill ? 'Report a live incident instead' : 'Log a past incident instead'}
            </button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit || createMutation.isPending}>
                {createMutation.isPending
                  ? 'Creating…'
                  : backfill
                    ? 'Log past incident'
                    : 'Publish incident'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
