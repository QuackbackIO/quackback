/**
 * SLA escalation create/edit dialog. Recipient sub-form is conditional on
 * recipientType. Channels is a multi-toggle. leadMinutes is signed.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { SlaPolicyId, EscalationRuleId, TeamId, PrincipalId } from '@quackback/ids'
import type { EscalationRule } from '@/lib/shared/db-types'
import { createEscalationRuleFn, updateEscalationRuleFn } from '@/lib/server/functions/sla'
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
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TeamPicker } from '@/components/admin/shared/team-picker'
import { PrincipalPicker } from '@/components/admin/shared/principal-picker'
import { cn } from '@/lib/shared/utils'

const TARGET_KINDS = ['first_response', 'next_response', 'resolution'] as const
const RECIPIENT_TYPES = ['assignee', 'team', 'principals', 'inbox_members'] as const
const CHANNELS = ['in_app', 'email', 'webhook'] as const
type TargetKind = (typeof TARGET_KINDS)[number]
type RecipientType = (typeof RECIPIENT_TYPES)[number]
type Channel = (typeof CHANNELS)[number]

interface Props {
  policyId: SlaPolicyId
  open: boolean
  onOpenChange: (open: boolean) => void
  rule?: EscalationRule
}

export function SlaEscalationDialog({ policyId, open, onOpenChange, rule }: Props) {
  const qc = useQueryClient()
  const isEdit = Boolean(rule)

  const [name, setName] = useState('')
  const [leadMinutes, setLeadMinutes] = useState(0)
  const [targetKind, setTargetKind] = useState<TargetKind>('first_response')
  const [recipientType, setRecipientType] = useState<RecipientType>('assignee')
  const [recipientTeamId, setRecipientTeamId] = useState<TeamId | null>(null)
  const [recipientPrincipalIds, setRecipientPrincipalIds] = useState<PrincipalId[]>([])
  const [channels, setChannels] = useState<Channel[]>(['in_app'])
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    if (!open) return
    if (rule) {
      setName(rule.name)
      setLeadMinutes(rule.leadMinutes)
      setTargetKind(rule.targetKind as TargetKind)
      setRecipientType(rule.recipientType as RecipientType)
      setRecipientTeamId((rule.recipientTeamId as TeamId | null) ?? null)
      setRecipientPrincipalIds(
        ((rule.recipientPrincipalIds as string[] | null) ?? []) as PrincipalId[]
      )
      setChannels(((rule.channels as Channel[] | null) ?? ['in_app']) as Channel[])
      setEnabled(rule.enabled)
    } else {
      setName('')
      setLeadMinutes(0)
      setTargetKind('first_response')
      setRecipientType('assignee')
      setRecipientTeamId(null)
      setRecipientPrincipalIds([])
      setChannels(['in_app'])
      setEnabled(true)
    }
  }, [open, rule])

  const toggleChannel = (c: Channel) => {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'Name is required'
    if (recipientType === 'team' && !recipientTeamId) return 'Pick a team'
    if (recipientType === 'principals' && recipientPrincipalIds.length === 0)
      return 'Pick at least one principal'
    if (channels.length === 0) return 'Pick at least one channel'
    return null
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createEscalationRuleFn({
        data: {
          policyId,
          name: name.trim(),
          leadMinutes,
          targetKind,
          recipientType,
          recipientTeamId: recipientType === 'team' ? recipientTeamId : null,
          recipientPrincipalIds: recipientType === 'principals' ? recipientPrincipalIds : undefined,
          channels,
          enabled,
        },
      }),
    onSuccess: () => {
      toast.success('Escalation created')
      qc.invalidateQueries({ queryKey: ['sla', 'escalations', policyId] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      updateEscalationRuleFn({
        data: {
          id: rule!.id as EscalationRuleId,
          name: name.trim(),
          leadMinutes,
          targetKind,
          recipientType,
          recipientTeamId: recipientType === 'team' ? recipientTeamId : null,
          recipientPrincipalIds: recipientType === 'principals' ? recipientPrincipalIds : undefined,
          channels,
          enabled,
        },
      }),
    onSuccess: () => {
      toast.success('Escalation updated')
      qc.invalidateQueries({ queryKey: ['sla', 'escalations', policyId] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSave = () => {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    if (isEdit) updateMutation.mutate()
    else createMutation.mutate()
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit escalation' : 'New escalation'}</DialogTitle>
          <DialogDescription>
            Fires relative to the chosen target&apos;s due time. Positive lead = before breach,
            negative = after.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="esc-name">Name</Label>
            <Input
              id="esc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Notify lead 15m before breach"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Target</Label>
              <Select value={targetKind} onValueChange={(v) => setTargetKind(v as TargetKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="esc-lead">Lead minutes (signed)</Label>
              <Input
                id="esc-lead"
                type="number"
                value={leadMinutes}
                onChange={(e) => setLeadMinutes(Number(e.target.value) || 0)}
              />
              <p className="text-[11px] text-muted-foreground">
                {leadMinutes > 0
                  ? `Fires ${leadMinutes}m before breach`
                  : leadMinutes < 0
                    ? `Fires ${Math.abs(leadMinutes)}m after breach`
                    : 'Fires at breach'}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Recipient type</Label>
            <Select
              value={recipientType}
              onValueChange={(v) => setRecipientType(v as RecipientType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECIPIENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {recipientType === 'team' && (
            <div className="space-y-2">
              <Label>Team</Label>
              <TeamPicker
                value={recipientTeamId}
                onValueChange={setRecipientTeamId}
                allowClear
                placeholder="Pick team…"
              />
            </div>
          )}
          {recipientType === 'principals' && (
            <div className="space-y-2">
              <Label>Principals</Label>
              <PrincipalPicker
                multiple
                value={recipientPrincipalIds}
                onValueChange={setRecipientPrincipalIds}
                placeholder="Pick principals…"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Channels</Label>
            <div className="flex flex-wrap gap-1">
              {CHANNELS.map((c) => {
                const checked = channels.includes(c)
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleChannel(c)}
                    className={cn(
                      'text-[11px] rounded border px-2 py-0.5',
                      checked
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border/60 text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {c}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="esc-enabled" />
            <Label htmlFor="esc-enabled" className="text-xs cursor-pointer">
              Enabled
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
