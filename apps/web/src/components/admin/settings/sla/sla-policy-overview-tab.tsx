/**
 * SLA policy overview tab — editable form. Scope is read-only (backend update
 * doesn't accept scope changes).
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { BusinessHoursId, SlaPolicyId } from '@quackback/ids'
import type { SlaPolicy } from '@/lib/shared/db-types'
import { updateSlaPolicyFn, archiveSlaPolicyFn } from '@/lib/server/functions/sla'
import { businessHoursQueries } from '@/lib/client/queries/business-hours'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { cn } from '@/lib/shared/utils'

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

export function SlaPolicyOverviewTab({ policy }: { policy: SlaPolicy }) {
  const qc = useQueryClient()
  const { data: calendars } = useSuspenseQuery(businessHoursQueries.list({}))

  const [name, setName] = useState(policy.name)
  const [description, setDescription] = useState(policy.description ?? '')
  const [priority, setPriority] = useState(policy.priority)
  const [enabled, setEnabled] = useState(policy.enabled)
  const [appliesToPriorities, setAppliesToPriorities] = useState<string[]>(
    (policy.appliesToPriorities as string[] | null) ?? []
  )
  const [businessHoursId, setBusinessHoursId] = useState<string>(
    (policy.businessHoursId as string | null) ?? ''
  )
  const [pauseOnPending, setPauseOnPending] = useState(policy.pauseOnPending)
  const [pauseOnOnHold, setPauseOnOnHold] = useState(policy.pauseOnOnHold)

  useEffect(() => {
    setName(policy.name)
    setDescription(policy.description ?? '')
    setPriority(policy.priority)
    setEnabled(policy.enabled)
    setAppliesToPriorities((policy.appliesToPriorities as string[] | null) ?? [])
    setBusinessHoursId((policy.businessHoursId as string | null) ?? '')
    setPauseOnPending(policy.pauseOnPending)
    setPauseOnOnHold(policy.pauseOnOnHold)
  }, [policy])

  const togglePriority = (p: string) => {
    setAppliesToPriorities((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    )
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateSlaPolicyFn({
        data: {
          id: policy.id as SlaPolicyId,
          name: name.trim(),
          description: description.trim() || null,
          priority,
          enabled,
          appliesToPriorities:
            appliesToPriorities.length > 0
              ? (appliesToPriorities as ('low' | 'normal' | 'high' | 'urgent')[])
              : undefined,
          businessHoursId: businessHoursId ? (businessHoursId as BusinessHoursId) : null,
          pauseOnPending,
          pauseOnOnHold,
        },
      }),
    onSuccess: () => {
      toast.success('Policy updated')
      qc.invalidateQueries({ queryKey: ['sla'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const archiveMutation = useMutation({
    mutationFn: () => archiveSlaPolicyFn({ data: { id: policy.id as SlaPolicyId } }),
    onSuccess: () => {
      toast.success('Policy archived')
      qc.invalidateQueries({ queryKey: ['sla'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Scope (cannot be changed)</Label>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{policy.scope}</Badge>
            {policy.scopeTeamId && (
              <span className="text-xs text-muted-foreground font-mono">
                team: {String(policy.scopeTeamId)}
              </span>
            )}
            {policy.scopeInboxId && (
              <span className="text-xs text-muted-foreground font-mono">
                inbox: {String(policy.scopeInboxId)}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ov-name">Name</Label>
          <Input id="ov-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ov-desc">Description</Label>
          <Textarea
            id="ov-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="ov-priority">Priority (lower runs first)</Label>
            <Input
              id="ov-priority"
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label>Business hours</Label>
            <Select
              value={businessHoursId || '__none'}
              onValueChange={(v) => setBusinessHoursId(v === '__none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None (24/7)</SelectItem>
                {calendars
                  .filter((c) => !c.archivedAt || c.id === businessHoursId)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Applies to priorities</Label>
          <div className="flex flex-wrap gap-1">
            {PRIORITIES.map((p) => {
              const checked = appliesToPriorities.includes(p)
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePriority(p)}
                  className={cn(
                    'text-[11px] rounded border px-2 py-0.5',
                    checked
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border/60 text-muted-foreground hover:bg-muted'
                  )}
                >
                  {p}
                </button>
              )
            })}
            {appliesToPriorities.length === 0 && (
              <span className="text-xs text-muted-foreground self-center ml-2">All priorities</span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Pause clocks when ticket is</Label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={pauseOnPending} onCheckedChange={setPauseOnPending} />
              Pending
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={pauseOnOnHold} onCheckedChange={setPauseOnOnHold} />
              On hold
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} id="ov-enabled" />
          <Label htmlFor="ov-enabled" className="text-xs cursor-pointer">
            Enabled
          </Label>
        </div>

        <PermissionGate permission={PERMISSIONS.SLA_MANAGE}>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            Save changes
          </Button>
        </PermissionGate>
      </div>

      {!policy.archivedAt && (
        <div className="rounded border border-destructive/30 p-3 space-y-2">
          <p className="text-xs font-semibold text-destructive">Archive</p>
          <p className="text-xs text-muted-foreground">
            Archived policies stop binding to new tickets. Existing clocks continue running.
          </p>
          <PermissionGate permission={PERMISSIONS.SLA_MANAGE}>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Archive policy
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive this SLA policy?</AlertDialogTitle>
                  <AlertDialogDescription>
                    New tickets will not bind to this policy. This cannot be undone via UI.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => archiveMutation.mutate()}>
                    Archive
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </PermissionGate>
        </div>
      )}
    </div>
  )
}
