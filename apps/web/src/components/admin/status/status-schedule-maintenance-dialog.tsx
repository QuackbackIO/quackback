/**
 * Schedule maintenance — its own dialog rather than a mode of the incident
 * form, so maintenance-only fields (window, automation) never crowd the
 * incident fast path and vice versa.
 */
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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

export function ScheduleMaintenanceDialog({
  variant = 'outline',
}: {
  variant?: 'default' | 'outline'
}) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const createMutation = useCreateStatusIncident()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [affected, setAffected] = useState<AffectedRow[]>([])
  // Provenance: which template seeded this window, if any (survives later edits).
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [scheduledStart, setScheduledStart] = useState<Date | undefined>(undefined)
  const [scheduledEnd, setScheduledEnd] = useState<Date | undefined>(undefined)
  const [autoStart, setAutoStart] = useState(true)
  const [autoComplete, setAutoComplete] = useState(true)
  const [notify, setNotify] = useState(true)

  function reset() {
    setTitle('')
    setBody('')
    setAffected([])
    setTemplateId(null)
    setScheduledStart(undefined)
    setScheduledEnd(undefined)
    setAutoStart(true)
    setAutoComplete(true)
    setNotify(true)
    createMutation.reset()
  }

  // The window bounds are required: a date-less window with autoStart on
  // would sit in 'scheduled' forever (no job is ever enqueued for a null
  // start bound).
  const canSubmit =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    affected.length > 0 &&
    !!scheduledStart &&
    !!scheduledEnd

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    try {
      const created = await createMutation.mutateAsync({
        kind: 'maintenance',
        title: title.trim(),
        status: 'scheduled',
        ...(templateId ? { templateId } : {}),
        affectedComponents: affected,
        body: body.trim(),
        scheduledStartAt: scheduledStart ?? null,
        scheduledEndAt: scheduledEnd ?? null,
        autoStart,
        autoComplete,
        notifySubscribers: notify,
      })
      setOpen(false)
      reset()
      void navigate({
        to: '/admin/status',
        search: { ...search, view: 'maintenance', incident: created.id },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to schedule maintenance')
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
          Schedule maintenance
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule maintenance</DialogTitle>
          <DialogDescription>
            Appears on your status page and emails subscribers once, when scheduled.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="maint-title">Title</Label>
              <TemplatePickerButton
                label="Start from template"
                onApply={(t) => {
                  setTitle(t.title)
                  setBody(t.body)
                  setAffected(templateToAffectedRows(t.componentIds, 'maintenance'))
                  setTemplateId(t.id)
                }}
              />
            </div>
            <Input
              id="maint-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Database maintenance window"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maint-body">What's planned?</Label>
            <Textarea
              id="maint-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What's happening during this window, and what should users expect?"
              className="min-h-20"
              required
            />
          </div>

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
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Switch checked={autoStart} onCheckedChange={setAutoStart} />
              Auto-start at scheduled time
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Switch checked={autoComplete} onCheckedChange={setAutoComplete} />
              Auto-complete at end time
            </label>
          </div>

          <div className="space-y-2">
            <Label>Affected services</Label>
            <AffectedComponentsField kind="maintenance" value={affected} onChange={setAffected} />
            <p className="text-xs text-muted-foreground">
              Services switch to Under maintenance while the window runs, then restore.
            </p>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox
              checked={notify}
              onCheckedChange={(c) => setNotify(c === true)}
              className="mt-0.5"
            />
            <span className="text-sm">
              Email subscribers
              <span className="block text-xs text-muted-foreground">
                One email when this is scheduled. Start, progress, and completion never email.
              </span>
            </span>
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || createMutation.isPending}>
              {createMutation.isPending ? 'Scheduling…' : 'Schedule maintenance'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
