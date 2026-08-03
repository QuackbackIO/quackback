/**
 * Tickets filed by/under an organization. Uses extended `listTicketsFn`
 * with `organizationId` filter (Phase G0a backend gap).
 */
import { Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { OrganizationId, TicketId } from '@quackback/ids'
import { listTicketsFn } from '@/lib/server/functions/tickets'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export function OrganizationTicketsTab({ organizationId }: { organizationId: OrganizationId }) {
  const { data } = useSuspenseQuery({
    queryKey: ['tickets', 'byOrg', organizationId],
    queryFn: () =>
      listTicketsFn({
        data: { scope: 'all', organizationId, limit: 100 },
      }),
    staleTime: 30_000,
  })

  return (
    <div className="rounded-md border border-border/50">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Subject</TableHead>
            <TableHead className="w-28">Priority</TableHead>
            <TableHead className="w-28">Channel</TableHead>
            <TableHead className="w-44">Last activity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                No tickets for this organization.
              </TableCell>
            </TableRow>
          ) : (
            data.rows.map((t) => (
              <TableRow key={t.id} className="hover:bg-muted/50">
                <TableCell className="font-medium">
                  <Link to="/admin/tickets/$ticketId" params={{ ticketId: t.id as TicketId }}>
                    {t.subject}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">
                    {t.priority}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{t.channel}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t.lastActivityAt ? new Date(t.lastActivityAt).toLocaleString() : '—'}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
