/**
 * Workflow & SLA performance (§4.6, §7). A compact read-only view of SLA
 * attainment + workflow run outcomes over the last 30 days, from the support
 * reporting aggregates. The richer charted breakdown belongs in the Analytics
 * dashboard; this surfaces the headline numbers where the automation is managed.
 */
import { useQuery } from '@tanstack/react-query'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { MetricTile, useLast30DaysRange, pct } from './metric-tile'
import { supportReportingQuery } from '@/lib/client/queries/support-reporting'

export function SupportPerformanceCard() {
  const range = useLast30DaysRange()
  const { data } = useQuery(supportReportingQuery(range.from, range.to))

  const fr = data?.sla.firstResponse
  const res = data?.sla.resolution
  const runs = (data?.workflows ?? []).reduce(
    (acc, w) => ({
      started: acc.started + w.started,
      completed: acc.completed + w.completed,
      interrupted: acc.interrupted + w.interrupted,
    }),
    { started: 0, completed: 0, interrupted: 0 }
  )

  return (
    <SettingsCard
      title="Performance"
      description="SLA attainment and workflow outcomes over the last 30 days."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricTile
          label="First response SLA"
          value={pct(fr?.rate)}
          sub={fr ? `${fr.met} met / ${fr.breached} breached` : undefined}
        />
        <MetricTile
          label="Resolution SLA"
          value={pct(res?.rate)}
          sub={res ? `${res.met} met / ${res.breached} breached` : undefined}
        />
        <MetricTile
          label="Workflow runs"
          value={String(runs.started)}
          sub={`${runs.completed} completed, ${runs.interrupted} interrupted`}
        />
      </div>
    </SettingsCard>
  )
}
