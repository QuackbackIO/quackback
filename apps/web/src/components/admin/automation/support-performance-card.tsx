/**
 * Workflow & SLA performance (§4.6, §7). A compact read-only view of SLA
 * attainment + workflow run outcomes over the last 30 days, from the support
 * reporting aggregates: four-clock attainment tiles, per-policy attainment,
 * the hourly breach distribution (the staffing view), and average
 * time-after-miss. The richer charted breakdown belongs in the Analytics
 * dashboard; this surfaces the headline numbers where the automation is
 * managed.
 */
import { useQuery } from '@tanstack/react-query'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { MetricTile, useLast30DaysRange, pct } from './metric-tile'
import { supportReportingQuery } from '@/lib/client/queries/support-reporting'
import { formatSlaCountdown } from '@/lib/shared/conversation/sla'
import type { SlaAttainment, SlaBreachHeatmapCell } from '@/lib/server/domains/sla/sla-reporting'

const CLOCKS: { key: keyof SlaAttainment; label: string }[] = [
  { key: 'firstResponse', label: 'First response' },
  { key: 'nextResponse', label: 'Next response' },
  { key: 'resolution', label: 'Resolution' },
  { key: 'timeToResolve', label: 'Time to resolve' },
]

/** ISODOW 1 (Monday) - 7 (Sunday), matching the heatmap cells' `dow`. */
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** 7x24 day-of-week x hour grid, intensity-shaded by breach count. */
function BreachHeatmap({ cells }: { cells: SlaBreachHeatmapCell[] }) {
  const lookup = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c.count] as const))
  const max = Math.max(0, ...cells.map((c) => c.count))
  if (max === 0) {
    return <p className="text-xs text-muted-foreground">No breaches recorded in this window.</p>
  }
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
                    title={`${label} ${String(hour).padStart(2, '0')}:00 — ${n} breach${n === 1 ? '' : 'es'}`}
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

export function SupportPerformanceCard() {
  const range = useLast30DaysRange()
  const { data } = useQuery(supportReportingQuery(range.from, range.to))

  const runs = (data?.workflows ?? []).reduce(
    (acc, w) => ({
      started: acc.started + w.started,
      completed: acc.completed + w.completed,
      interrupted: acc.interrupted + w.interrupted,
    }),
    { started: 0, completed: 0, interrupted: 0 }
  )
  const miss = data?.slaTimeAfterMiss
  const anyMiss = miss != null && CLOCKS.some((c) => miss[c.key].count > 0)

  return (
    <SettingsCard
      title="Performance"
      description="SLA attainment and workflow outcomes over the last 30 days."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CLOCKS.map((c) => {
          const clock = data?.sla[c.key]
          return (
            <MetricTile
              key={c.key}
              label={`${c.label} SLA`}
              value={pct(clock?.rate)}
              sub={clock ? `${clock.met} met / ${clock.breached} breached` : undefined}
            />
          )
        })}
        <MetricTile
          label="Workflow runs"
          value={String(runs.started)}
          sub={`${runs.completed} completed, ${runs.interrupted} interrupted`}
        />
      </div>

      {data && data.slaByPolicy.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium">Attainment by policy</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1 font-medium">Policy</th>
                {CLOCKS.map((c) => (
                  <th key={c.key} className="pb-1 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slaByPolicy.map((p) => (
                <tr key={p.policyId} className="border-t border-border/50">
                  <td className="max-w-40 truncate py-1.5 pr-2">{p.policyName}</td>
                  {CLOCKS.map((c) => {
                    const cell = p[c.key]
                    return (
                      <td key={c.key} className="py-1.5 text-right tabular-nums">
                        {pct(cell.rate)}{' '}
                        {cell.rate != null && (
                          <span className="text-xs text-muted-foreground">
                            ({cell.met}/{cell.met + cell.breached})
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium">
            Breaches by time of week{' '}
            <span className="text-xs font-normal text-muted-foreground">(UTC)</span>
          </h3>
          <BreachHeatmap cells={data.slaHeatmap} />
        </div>
      )}

      {anyMiss && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium">Avg time after miss</h3>
          <p className="text-sm">
            {CLOCKS.map((c, i) => {
              const m = miss[c.key]
              return (
                <span key={c.key}>
                  {i > 0 && <span className="text-muted-foreground"> · </span>}
                  <span className="text-muted-foreground">{c.label.toLowerCase()} </span>
                  {m.count > 0 && m.avgOverdueSecs != null ? (
                    <>
                      {formatSlaCountdown(m.avgOverdueSecs * 1000)}{' '}
                      <span className="text-xs text-muted-foreground">({m.count})</span>
                    </>
                  ) : (
                    '—'
                  )}
                </span>
              )
            })}
          </p>
        </div>
      )}
    </SettingsCard>
  )
}
