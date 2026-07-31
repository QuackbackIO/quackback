import { Avatar } from '@/components/ui/avatar'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { AnalyticsEmpty } from './analytics-empty'
import { formatResponseTime } from './analytics-constants'
import type { TeammatePerformance } from '@/lib/server/domains/analytics/teammate-performance'

/** Per-teammate support workload: conversations handled with median first
 *  response and median time to close. Rows arrive sorted by handled desc. */
export function AnalyticsTeammatePerformance({ teammates }: { teammates: TeammatePerformance[] }) {
  if (teammates.length === 0) {
    return <AnalyticsEmpty message="No assigned conversations in this period" />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Teammate</TableHead>
          <TableHead className="text-right">Conversations</TableHead>
          <TableHead className="text-right">Median first response</TableHead>
          <TableHead className="text-right">Median time to close</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {teammates.map((t) => (
          <TableRow key={t.agentId}>
            <TableCell>
              <div className="flex items-center gap-2">
                <Avatar
                  src={t.avatarUrl}
                  name={t.displayName}
                  className="size-5 shrink-0 text-xs"
                />
                <span className="truncate font-medium">{t.displayName}</span>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{t.handled.toLocaleString()}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatResponseTime(t.medianFirstResponseMinutes)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatResponseTime(t.medianCloseMinutes)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
