/**
 * Business-hours list — table with name/timezone/holiday count + edit/archive
 * actions. "Show archived" toggle. Edit opens the shared dialog with prefill.
 */
import { useState } from 'react'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { BusinessHoursId } from '@quackback/ids'
import type { BusinessHours } from '@/lib/shared/db-types'
import { businessHoursQueries } from '@/lib/client/queries/business-hours'
import { archiveBusinessHoursFn } from '@/lib/server/functions/sla'
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
import { PencilSquareIcon, ArchiveBoxIcon } from '@heroicons/react/24/outline'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { BusinessHoursDialog } from './business-hours-dialog'

export function BusinessHoursList() {
  const qc = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  const [editingRow, setEditingRow] = useState<BusinessHours | null>(null)
  const { data: rows } = useSuspenseQuery(businessHoursQueries.list({ includeArchived: true }))

  const archiveMutation = useMutation({
    mutationFn: (id: BusinessHoursId) => archiveBusinessHoursFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business-hours'] })
      toast.success('Calendar archived')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const visible = rows.filter((r) => showArchived || !r.archivedAt)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch id="show-archived-bh" checked={showArchived} onCheckedChange={setShowArchived} />
        <Label htmlFor="show-archived-bh" className="text-xs cursor-pointer">
          Show archived
        </Label>
      </div>

      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Timezone</TableHead>
              <TableHead className="w-24">Holidays</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                  No calendars yet.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => {
                const holidays = (row.holidays as unknown[] | null) ?? []
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="font-mono text-xs">{row.timezone}</TableCell>
                    <TableCell>{holidays.length}</TableCell>
                    <TableCell>
                      {row.archivedAt ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Archived
                        </Badge>
                      ) : (
                        <Badge variant="outline">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <PermissionGate permission={PERMISSIONS.BUSINESS_HOURS_MANAGE}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setEditingRow(row)}
                            aria-label="Edit calendar"
                          >
                            <PencilSquareIcon className="h-3.5 w-3.5" />
                          </Button>
                          {!row.archivedAt && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  aria-label="Archive calendar"
                                >
                                  <ArchiveBoxIcon className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Archive this calendar?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    SLA policies referencing it will continue to work, but it
                                    won&apos;t appear in pickers for new policies.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() =>
                                      archiveMutation.mutate(row.id as BusinessHoursId)
                                    }
                                  >
                                    Archive
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
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

      <BusinessHoursDialog
        open={editingRow !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRow(null)
        }}
        row={editingRow ?? undefined}
      />
    </div>
  )
}
