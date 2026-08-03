/**
 * SLA policy create dialog. Scope is creation-only (backend update doesn't
 * accept scope changes). On success navigates to the detail page so the user
 * can configure targets + escalations.
 */
import { useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { TeamId, InboxId, BusinessHoursId, SlaPolicyId } from '@quackback/ids'
import { createSlaPolicyFn } from '@/lib/server/functions/sla'
import { businessHoursQueries } from '@/lib/client/queries/business-hours'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TeamPicker } from '@/components/admin/shared/team-picker'
import { InboxPicker } from '@/components/admin/shared/inbox-picker'
import { cn } from '@/lib/shared/utils'

type Scope = 'workspace' | 'team' | 'inbox'
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SlaPolicyCreateDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient()
  const router = useRouter()
  const { data: calendars } = useSuspenseQuery(businessHoursQueries.list({}))

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<Scope>('workspace')
  const [scopeTeamId, setScopeTeamId] = useState<TeamId | null>(null)
  const [scopeInboxId, setScopeInboxId] = useState<InboxId | null>(null)
  const [appliesToPriorities, setAppliesToPriorities] = useState<string[]>([])
  const [businessHoursId, setBusinessHoursId] = useState<string>('')
  const [pauseOnPending, setPauseOnPending] = useState(true)
  const [pauseOnOnHold, setPauseOnOnHold] = useState(true)
  const [enabled, setEnabled] = useState(true)
  const [priority, setPriority] = useState(100)

  const reset = () => {
    setName('')
    setDescription('')
    setScope('workspace')
    setScopeTeamId(null)
    setScopeInboxId(null)
    setAppliesToPriorities([])
    setBusinessHoursId('')
    setPauseOnPending(true)
    setPauseOnOnHold(true)
    setEnabled(true)
    setPriority(100)
  }

  const togglePriority = (p: string) => {
    setAppliesToPriorities((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    )
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createSlaPolicyFn({
        data: {
          name: name.trim(),
          description: description.trim() || null,
          priority,
          enabled,
          scope,
          scopeTeamId: scope === 'team' ? scopeTeamId : null,
          scopeInboxId: scope === 'inbox' ? scopeInboxId : null,
          appliesToPriorities:
            appliesToPriorities.length > 0
              ? (appliesToPriorities as ('low' | 'normal' | 'high' | 'urgent')[])
              : undefined,
          businessHoursId: businessHoursId ? (businessHoursId as BusinessHoursId) : null,
          pauseOnPending,
          pauseOnOnHold,
        },
      }),
    onSuccess: (policy) => {
      toast.success('Policy created')
      qc.invalidateQueries({ queryKey: ['sla'] })
      onOpenChange(false)
      reset()
      router.navigate({
        to: '/admin/settings/sla/$policyId',
        params: { policyId: policy.id as SlaPolicyId },
      })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (scope === 'team' && !scopeTeamId) {
      toast.error('Pick a team for team scope')
      return
    }
    if (scope === 'inbox' && !scopeInboxId) {
      toast.error('Pick an inbox for inbox scope')
      return
    }
    createMutation.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New SLA policy</DialogTitle>
          <DialogDescription>
            Scope determines which tickets the policy applies to. Targets and escalations are
            configured after creation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sla-name">Name</Label>
            <Input
              id="sla-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Premium customer SLA"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sla-desc">Description</Label>
            <Textarea
              id="sla-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workspace">Workspace</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                  <SelectItem value="inbox">Inbox</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sla-priority">Priority (lower runs first)</Label>
              <Input
                id="sla-priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          {scope === 'team' && (
            <div className="space-y-2">
              <Label>Team</Label>
              <TeamPicker
                value={scopeTeamId}
                onValueChange={setScopeTeamId}
                allowClear
                placeholder="Pick team…"
              />
            </div>
          )}
          {scope === 'inbox' && (
            <div className="space-y-2">
              <Label>Inbox</Label>
              <InboxPicker
                value={scopeInboxId}
                onValueChange={setScopeInboxId}
                allowClear
                placeholder="Pick inbox…"
              />
            </div>
          )}

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
                <span className="text-xs text-muted-foreground self-center ml-2">
                  All priorities
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Business hours</Label>
            <Select
              value={businessHoursId || '__none'}
              onValueChange={(v) => setBusinessHoursId(v === '__none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick calendar…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None (24/7)</SelectItem>
                {calendars
                  .filter((c) => !c.archivedAt)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
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
            <Switch checked={enabled} onCheckedChange={setEnabled} id="sla-enabled" />
            <Label htmlFor="sla-enabled" className="text-xs cursor-pointer">
              Enabled
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={createMutation.isPending}>
            Create policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
