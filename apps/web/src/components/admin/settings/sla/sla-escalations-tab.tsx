/**
 * SLA escalations tab — list of escalation rules with inline enable toggle,
 * edit + delete buttons. New/edit opens the shared escalation dialog.
 */
import { useState } from 'react'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { SlaPolicyId, EscalationRuleId } from '@quackback/ids'
import type { EscalationRule } from '@/lib/shared/db-types'
import { slaQueries } from '@/lib/client/queries/sla'
import { updateEscalationRuleFn, deleteEscalationRuleFn } from '@/lib/server/functions/sla'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { PencilSquareIcon, TrashIcon, PlusIcon } from '@heroicons/react/24/outline'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { SlaEscalationDialog } from './sla-escalation-dialog'

function formatLead(lead: number): string {
  if (lead > 0) return `${lead}m before breach`
  if (lead < 0) return `${Math.abs(lead)}m after breach`
  return 'At breach'
}

export function SlaEscalationsTab({ policyId }: { policyId: SlaPolicyId }) {
  const qc = useQueryClient()
  const { data: rules } = useSuspenseQuery(slaQueries.escalations(policyId))
  const [createOpen, setCreateOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<EscalationRule | null>(null)

  const toggleEnabled = useMutation({
    mutationFn: (vars: { id: EscalationRuleId; enabled: boolean }) =>
      updateEscalationRuleFn({ data: { id: vars.id, enabled: vars.enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sla', 'escalations', policyId] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: EscalationRuleId) => deleteEscalationRuleFn({ data: { id } }),
    onSuccess: () => {
      toast.success('Escalation rule deleted')
      qc.invalidateQueries({ queryKey: ['sla', 'escalations', policyId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-3 max-w-4xl">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Escalations fire relative to a target&apos;s due time and notify recipients on the chosen
          channels.
        </p>
        <PermissionGate permission={PERMISSIONS.ESCALATION_RULE_MANAGE}>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="h-4 w-4 mr-1" />
            New escalation
          </Button>
        </PermissionGate>
      </div>

      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Target</TableHead>
              <TableHead className="w-40">When</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead className="w-40">Channels</TableHead>
              <TableHead className="w-20">Enabled</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                  No escalation rules yet.
                </TableCell>
              </TableRow>
            ) : (
              rules.map((r) => {
                const channels = (r.channels as string[] | null) ?? []
                const principalIds = (r.recipientPrincipalIds as string[] | null) ?? []
                let recipientLabel: string = r.recipientType
                if (r.recipientType === 'team' && r.recipientTeamId) {
                  recipientLabel = `team: ${String(r.recipientTeamId)}`
                } else if (r.recipientType === 'principals') {
                  recipientLabel = `${principalIds.length} principal(s)`
                }
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {r.targetKind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{formatLead(r.leadMinutes)}</TableCell>
                    <TableCell className="text-xs">{recipientLabel}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {channels.map((c) => (
                          <Badge key={c} variant="outline" className="text-[10px]">
                            {c}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <PermissionGate
                        permission={PERMISSIONS.ESCALATION_RULE_MANAGE}
                        fallback={
                          <Badge variant="outline" className="text-[10px]">
                            {r.enabled ? 'On' : 'Off'}
                          </Badge>
                        }
                      >
                        <Switch
                          checked={r.enabled}
                          onCheckedChange={(v) =>
                            toggleEnabled.mutate({
                              id: r.id as EscalationRuleId,
                              enabled: v,
                            })
                          }
                        />
                      </PermissionGate>
                    </TableCell>
                    <TableCell>
                      <PermissionGate permission={PERMISSIONS.ESCALATION_RULE_MANAGE}>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setEditingRule(r)}
                            aria-label="Edit escalation"
                          >
                            <PencilSquareIcon className="h-3.5 w-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                aria-label="Delete escalation"
                              >
                                <TrashIcon className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this escalation?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  &quot;{r.name}&quot; will stop firing on this policy.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(r.id as EscalationRuleId)}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </PermissionGate>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <SlaEscalationDialog policyId={policyId} open={createOpen} onOpenChange={setCreateOpen} />
      <SlaEscalationDialog
        policyId={policyId}
        open={editingRule !== null}
        onOpenChange={(o) => {
          if (!o) setEditingRule(null)
        }}
        rule={editingRule ?? undefined}
      />
    </div>
  )
}
