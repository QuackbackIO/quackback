import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { supportReportingQuery } from '@/lib/client/queries/support-reporting'
import type { DateRange } from '@/lib/client/queries/analytics'
import { formatSlaCountdown } from '@/lib/shared/conversation/sla'
import type { SlaAttainment, SlaBreachHeatmapCell } from '@/lib/server/domains/sla/sla-reporting'
import { AnalyticsEmpty } from './analytics-empty'
import { ChartSkeleton } from './analytics-skeletons'

const CLOCKS: { key: keyof SlaAttainment; label: string }[] = [
  { key: 'firstResponse', label: 'First response' },
  { key: 'nextResponse', label: 'Next response' },
  { key: 'resolution', label: 'Time to close' },
  { key: 'timeToResolve', label: 'Time to resolve' },
]

/** ISODOW 1 (Monday) to 7 (Sunday), matching the heatmap cells' `dow`. */
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** A 0-1 attainment rate as a whole percent; a clock nothing was tracked on reads as a hyphen. */
function rateLabel(rate: number | null | undefined): string {
  return rate == null ? '-' : `${Math.round(rate * 100)}%`
}

/** 7x24 day-of-week by hour grid, shaded by breach count (UTC). */
function BreachHeatmap({ cells }: { cells: SlaBreachHeatmapCell[] }) {
  const lookup = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c.count] as const))
  const max = Math.max(0, ...cells.map((c) => c.count))
  if (max === 0) return <AnalyticsEmpty className="h-24" message="No breaches in this period" />
  return (
    <div className="space-y-0.5">
      {DOW_LABELS.map((label, i) => {
        const dow = i + 1
        return (
          <div key={dow} className="flex items-center gap-1.5">
            <span className="w-8 shrink-0 text-xs text-muted-foreground">{label}</span>
            <div className="flex flex-1 gap-0.5">
              {Array.from({ length: 24 }, (_, hour) => {
                const n = lookup.get(`${dow}:${hour}`) ?? 0
                return (
                  <div
                    key={hour}
                    title={`${label} ${String(hour).padStart(2, '0')}:00, ${n} ${n === 1 ? 'breach' : 'breaches'}`}
                    className="h-3.5 flex-1 rounded-[2px] bg-primary"
                    style={{ opacity: n === 0 ? 0.08 : 0.15 + 0.85 * (n / max) }}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
      <div className="flex items-center gap-1.5">
        <span className="w-8 shrink-0" />
        <div className="flex flex-1 gap-0.5">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="flex-1 text-center text-xs text-muted-foreground">
              {h % 6 === 0 ? h : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The Support section's SLA and workflow cards: attainment per clock and per
 *  policy, breaches by hour, time after a miss, and workflow run outcomes. */
export function AnalyticsSlaCards({ range }: { range: DateRange }) {
  const { data, isLoading } = useQuery(supportReportingQuery(range.from, range.to))

  if (isLoading || !data) return <ChartSkeleton className="h-64 rounded-xl" />

  const runs = data.workflows.reduce(
    (acc, w) => ({
      started: acc.started + w.started,
      completed: acc.completed + w.completed,
      interrupted: acc.interrupted + w.interrupted,
      waiting: acc.waiting + w.waiting,
    }),
    { started: 0, completed: 0, interrupted: 0, waiting: 0 }
  )
  const missed = CLOCKS.filter((c) => data.slaTimeAfterMiss[c.key].count > 0)

  return (
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
        <Card>
          <CardHeader>
            <CardTitle>SLA attainment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Target</TableHead>
                  <TableHead className="text-right">Met</TableHead>
                  <TableHead className="text-right">Missed</TableHead>
                  <TableHead className="text-right">Attained</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CLOCKS.map((c) => {
                  const clock = data.sla[c.key]
                  return (
                    <TableRow key={c.key}>
                      <TableCell>{c.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{clock.met}</TableCell>
                      <TableCell className="text-right tabular-nums">{clock.breached}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rateLabel(clock.rate)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {data.slaByPolicy.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Policy</TableHead>
                    {CLOCKS.map((c) => (
                      <TableHead key={c.key} className="text-right">
                        {c.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.slaByPolicy.map((p) => (
                    <TableRow key={p.policyId}>
                      <TableCell className="max-w-40 truncate">{p.policyName}</TableCell>
                      {CLOCKS.map((c) => (
                        <TableCell key={c.key} className="text-right tabular-nums">
                          {rateLabel(p[c.key].rate)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workflow runs</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.started === 0 ? (
              <AnalyticsEmpty message="No workflow runs in this period" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    [
                      ['Started', runs.started],
                      ['Completed', runs.completed],
                      ['Interrupted', runs.interrupted],
                      ['Waiting', runs.waiting],
                    ] as const
                  ).map(([label, value]) => (
                    <TableRow key={label}>
                      <TableCell>{label}</TableCell>
                      <TableCell className="text-right tabular-nums">{value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Breaches by hour</CardTitle>
        </CardHeader>
        <CardContent>
          <BreachHeatmap cells={data.slaHeatmap} />
          <p className="mt-2 text-xs text-muted-foreground">Times are UTC.</p>
        </CardContent>
      </Card>

      {missed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Time after a miss</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Target</TableHead>
                  <TableHead className="text-right">Misses</TableHead>
                  <TableHead className="text-right">Average overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {missed.map((c) => {
                  const m = data.slaTimeAfterMiss[c.key]
                  return (
                    <TableRow key={c.key}>
                      <TableCell>{c.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.avgOverdueSecs == null
                          ? '-'
                          : formatSlaCountdown(m.avgOverdueSecs * 1000)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  )
}
