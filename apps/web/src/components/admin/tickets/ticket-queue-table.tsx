/**
 * Tickets queue table — checkbox bulk-select, status pill, priority chip,
 * channel icon, last-activity timestamp. Bulk-action toolbar is gated by the
 * `TICKET_BULK_OPERATE` permission.
 */
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TicketId, InboxId, PrincipalId, TicketStatusId } from '@quackback/ids'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TicketStatusPill, type StatusCategory } from './ticket-status-pill'
import { TicketPriorityChip, type TicketPriority } from './ticket-priority-chip'
import { TicketChannelIcon, type TicketChannel } from './ticket-channel-icon'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PrincipalPicker } from '@/components/admin/shared/principal-picker'
import { StatusPicker } from '@/components/admin/shared/status-picker'
import { InboxPicker } from '@/components/admin/shared/inbox-picker'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import {
  bulkAssignTicketsFn,
  bulkTransitionTicketsFn,
  bulkChangeInboxFn,
} from '@/lib/server/functions/tickets'
import { toast } from 'sonner'

interface TicketRow {
  id: string
  subject: string
  statusId: string
  priority: string
  channel: string
  lastActivityAt: Date | string
  assigneePrincipalId: string | null
}

interface StatusRow {
  id: string
  name: string
  category: StatusCategory
}

export interface TicketQueueTableProps {
  rows: TicketRow[]
  statuses: StatusRow[]
  invalidateKey: readonly unknown[]
}

const BULK_CONFIRM_THRESHOLD = 50

export function TicketQueueTable({ rows, statuses, invalidateKey }: TicketQueueTableProps) {
  const queryClient = useQueryClient()
  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const allSelected = rows.length > 0 && selected.size === rows.length
  const someSelected = selected.size > 0 && selected.size < rows.length

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(rows.map((r) => r.id)))
  }
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: invalidateKey })

  const assignMutation = useMutation({
    mutationFn: (assigneePrincipalId: PrincipalId) =>
      bulkAssignTicketsFn({
        data: {
          ticketIds: Array.from(selected) as TicketId[],
          assigneePrincipalId,
        },
      }),
    onSuccess: (res) => {
      const n = res.succeeded.length
      toast.success(`Assigned ${n} ticket${n === 1 ? '' : 's'}`)
      setSelected(new Set())
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message ?? 'Bulk assign failed'),
  })

  const transitionMutation = useMutation({
    mutationFn: (statusId: TicketStatusId) =>
      bulkTransitionTicketsFn({
        data: {
          ticketIds: Array.from(selected) as TicketId[],
          statusId,
        },
      }),
    onSuccess: (res) => {
      const n = res.succeeded.length
      toast.success(`Transitioned ${n} ticket${n === 1 ? '' : 's'}`)
      setSelected(new Set())
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message ?? 'Bulk transition failed'),
  })

  const changeInboxMutation = useMutation({
    mutationFn: (inboxId: InboxId | null) =>
      bulkChangeInboxFn({
        data: {
          ticketIds: Array.from(selected) as TicketId[],
          inboxId,
        },
      }),
    onSuccess: (res) => {
      const n = res.succeeded.length
      toast.success(`Moved ${n} ticket${n === 1 ? '' : 's'}`)
      setSelected(new Set())
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message ?? 'Bulk change inbox failed'),
  })

  // ---------------------------------------------------------- confirm modal
  const [pending, setPending] = useState<null | (() => void)>(null)
  const guard = (action: () => void) => {
    if (selected.size > BULK_CONFIRM_THRESHOLD) setPending(() => action)
    else action()
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No tickets in this view.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PermissionGate permission={PERMISSIONS.TICKET_BULK_OPERATE}>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 border-b border-border/50 bg-muted/40 px-4 py-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>

            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline">
                  Assign…
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-2 w-72">
                <PrincipalPicker
                  value={null}
                  onValueChange={(id) =>
                    id && guard(() => assignMutation.mutate(id as PrincipalId))
                  }
                  placeholder="Pick assignee…"
                />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline">
                  Transition…
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-2 w-72">
                <StatusPicker
                  value={null}
                  onValueChange={(id) =>
                    id && guard(() => transitionMutation.mutate(id as TicketStatusId))
                  }
                  placeholder="Pick status…"
                />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline">
                  Change inbox…
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-2 w-72">
                <InboxPicker
                  value={null}
                  onValueChange={(id) =>
                    guard(() => changeInboxMutation.mutate((id as InboxId | null) ?? null))
                  }
                  placeholder="Pick inbox…"
                  allowClear
                />
              </PopoverContent>
            </Popover>

            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        )}
      </PermissionGate>

      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead className="w-16">Channel</TableHead>
              <TableHead>Last activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => {
              const status = statusById.get(t.statusId)
              const isSel = selected.has(t.id)
              return (
                <TableRow key={t.id} className="hover:bg-muted/30 group">
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSel}
                      onCheckedChange={() => toggleOne(t.id)}
                      aria-label={`Select ${t.subject}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      to="/admin/tickets/$ticketId"
                      params={{ ticketId: t.id as TicketId }}
                      className="hover:underline"
                    >
                      {t.subject}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {status ? (
                      <TicketStatusPill name={status.name} category={status.category} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <TicketPriorityChip priority={t.priority as TicketPriority} />
                  </TableCell>
                  <TableCell>
                    <TicketChannelIcon channel={t.channel as TicketChannel} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <TimeAgo date={t.lastActivityAt} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={pending !== null} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm bulk action</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to apply this action to {selected.size} tickets. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPending(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                pending?.()
                setPending(null)
              }}
            >
              Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
