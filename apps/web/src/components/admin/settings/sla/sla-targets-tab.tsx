/**
 * SLA targets tab. Three rows for first_response/next_response/resolution.
 * Targets are bulk-replaced server-side: omit a kind to remove its target.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { SlaPolicyId } from '@quackback/ids'
import type { SlaTarget } from '@/lib/shared/db-types'
import { replaceSlaTargetsFn } from '@/lib/server/functions/sla'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const KINDS = [
  { key: 'first_response', label: 'First response', desc: 'Time to first agent reply' },
  { key: 'next_response', label: 'Next response', desc: 'Time between subsequent replies' },
  { key: 'resolution', label: 'Resolution', desc: 'Time until ticket is resolved' },
] as const
type Kind = (typeof KINDS)[number]['key']

interface Props {
  policyId: SlaPolicyId
  initialTargets: SlaTarget[]
}

export function SlaTargetsTab({ policyId, initialTargets }: Props) {
  const qc = useQueryClient()
  const initial: Record<Kind, string> = { first_response: '', next_response: '', resolution: '' }
  for (const t of initialTargets) {
    if (t.kind in initial) initial[t.kind as Kind] = String(t.minutes)
  }
  const [values, setValues] = useState<Record<Kind, string>>(initial)

  const saveMutation = useMutation({
    mutationFn: () => {
      const targets: { kind: Kind; minutes: number }[] = []
      for (const { key } of KINDS) {
        const raw = values[key].trim()
        if (!raw) continue
        const n = Number(raw)
        if (Number.isInteger(n) && n > 0) targets.push({ kind: key, minutes: n })
      }
      return replaceSlaTargetsFn({ data: { policyId, targets } })
    },
    onSuccess: () => {
      toast.success('Targets updated')
      qc.invalidateQueries({ queryKey: ['sla'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-xs text-muted-foreground">
        Leave a target empty to remove it. Times are in minutes; the SLA engine will compute due
        timestamps using the policy&apos;s business hours.
      </p>
      <div className="space-y-3">
        {KINDS.map(({ key, label, desc }) => (
          <div key={key} className="grid grid-cols-[1fr,160px] gap-3 items-end">
            <div>
              <Label htmlFor={`tgt-${key}`}>{label}</Label>
              <p className="text-[11px] text-muted-foreground">{desc}</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id={`tgt-${key}`}
                type="number"
                min={0}
                value={values[key]}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder="—"
                className="h-8 text-xs"
              />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          </div>
        ))}
      </div>
      <PermissionGate permission={PERMISSIONS.SLA_MANAGE}>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          Save targets
        </Button>
      </PermissionGate>
    </div>
  )
}
