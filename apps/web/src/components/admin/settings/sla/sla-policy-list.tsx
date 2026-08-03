/**
 * SLA policy list. Each row links to detail. Inline enabled toggle.
 */
import { useState } from 'react'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { SlaPolicyId } from '@quackback/ids'
import { slaQueries } from '@/lib/client/queries/sla'
import { businessHoursQueries } from '@/lib/client/queries/business-hours'
import { updateSlaPolicyFn } from '@/lib/server/functions/sla'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'

export function SlaPolicyList() {
  const qc = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  const { data: policies } = useSuspenseQuery(slaQueries.policies({ includeArchived: true }))
  const { data: calendars } = useSuspenseQuery(businessHoursQueries.list({}))

  const calendarLabel = (id: string | null): string => {
    if (!id) return '—'
    const c = calendars.find((x) => x.id === id)
    return c?.name ?? '—'
  }

  const toggleEnabled = useMutation({
    mutationFn: (vars: { id: SlaPolicyId; enabled: boolean }) =>
      updateSlaPolicyFn({ data: { id: vars.id, enabled: vars.enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sla'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const visible = policies.filter((p) => showArchived || !p.archivedAt)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch id="show-archived-sla" checked={showArchived} onCheckedChange={setShowArchived} />
        <Label htmlFor="show-archived-sla" className="text-xs cursor-pointer">
          Show archived
        </Label>
      </div>

      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Scope</TableHead>
              <TableHead>Priorities</TableHead>
              <TableHead className="w-44">Business hours</TableHead>
              <TableHead className="w-20">Enabled</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                  No SLA policies yet.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((p) => {
                const priorities = (p.appliesToPriorities as string[] | null) ?? []
                return (
                  <TableRow key={p.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">
                      <Link
                        to="/admin/settings/sla/$policyId"
                        params={{ policyId: p.id }}
                        className="hover:underline"
                      >
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {p.scope}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {priorities.length === 0 ? (
                          <span className="text-xs text-muted-foreground">All</span>
                        ) : (
                          priorities.map((pr) => (
                            <Badge key={pr} variant="outline" className="text-[10px]">
                              {pr}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {calendarLabel(p.businessHoursId as string | null)}
                    </TableCell>
                    <TableCell>
                      <PermissionGate
                        permission={PERMISSIONS.SLA_MANAGE}
                        fallback={
                          <Badge variant="outline" className="text-[10px]">
                            {p.enabled ? 'On' : 'Off'}
                          </Badge>
                        }
                      >
                        <Switch
                          checked={p.enabled}
                          onCheckedChange={(v) =>
                            toggleEnabled.mutate({
                              id: p.id as SlaPolicyId,
                              enabled: v,
                            })
                          }
                        />
                      </PermissionGate>
                    </TableCell>
                    <TableCell>
                      {p.archivedAt ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Archived
                        </Badge>
                      ) : (
                        <Badge variant="outline">Active</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
