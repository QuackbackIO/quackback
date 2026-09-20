/**
 * How the work went, beside how the conversations went (QUINN-PRODUCT P8).
 *
 * The performance card next to this one answers the product question. This one
 * answers the operator's, and every number is a count of real rows: runs that
 * failed, runs a newer message replaced, candidates a validator refused,
 * effects nobody could confirm, approvals still owed an execution.
 *
 * A workspace with no runs in the range gets dashes and one line saying what to
 * do about it, never a grid of zeroes. `pct` already renders a null rate as a
 * dash, which is why every rate in the report is null rather than zero when
 * there was nothing to divide by.
 */
import { useQuery } from '@tanstack/react-query'
import { quinnOperationsQuery } from '@/lib/client/queries/assistant-operations-analytics'
import { MetricTile, pct, asRate, useLast30DaysRange } from './metric-tile'

function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  if (value < 1_000) return `${value}ms`
  return `${(value / 1_000).toFixed(1)}s`
}

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? '-' : String(value)
}

export function QuinnOperationsCard() {
  const range = useLast30DaysRange()
  const { data } = useQuery(quinnOperationsQuery(range.from, range.to))

  const runs = data?.runs
  const actions = data?.actions
  const approvals = data?.approvals

  return (
    <section className="space-y-3" aria-label="Quinn operations">
      <h2 className="text-sm font-medium">Runs and actions</h2>
      {data && runs?.runs === 0 ? (
        <p className="text-muted-foreground text-sm">
          Quinn has not run in the last 30 days. Turn it on for customer conversations on Deploy,
          and the timings and outcomes appear here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile
              label="Turns"
              value={count(runs?.runs)}
              sub={runs ? `${runs.answered} answered` : undefined}
            />
            <MetricTile
              label="Failed"
              value={pct(asRate(runs?.failureRate))}
              sub={runs ? `${runs.failed} runs` : undefined}
            />
            <MetricTile label="Unanswered" value={count(runs?.unanswered)} />
            <MetricTile
              label="Unsupported"
              value={pct(asRate(runs?.unsupportedRate))}
              sub={runs ? `${runs.unsupported} refused by validation` : undefined}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile
              label="Wait to start"
              value={ms(runs?.queueToStartP50Ms)}
              sub={runs?.queueToStartP95Ms ? `95th ${ms(runs.queueToStartP95Ms)}` : undefined}
            />
            <MetricTile label="Turn time" value={ms(runs?.totalP50Ms)} sub="median" />
            <MetricTile
              label="Actions completed"
              value={pct(asRate(actions?.successRate))}
              sub={actions ? `${actions.succeeded} of ${actions.attempted}` : undefined}
            />
            <MetricTile
              label="Unconfirmed"
              value={count(actions?.unknown)}
              sub={
                actions?.awaitingReconciliation
                  ? `${actions.awaitingReconciliation} awaiting a verdict`
                  : undefined
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile
              label="Approvals decided"
              value={pct(asRate(approvals?.decisionRate))}
              sub={approvals ? `${approvals.proposed} proposed` : undefined}
            />
            <MetricTile
              label="Approvals completed"
              value={pct(asRate(approvals?.completionRate))}
              sub={approvals ? `${approvals.executed} executed` : undefined}
            />
            <MetricTile
              label="Execution owed"
              value={count(approvals?.owed)}
              sub="approved, not run yet"
            />
            <MetricTile label="Open now" value={count(runs?.open)} sub="runs in flight" />
          </div>
          {data && data.steps.length > 0 && (
            <ul className="text-muted-foreground space-y-0.5 text-xs">
              {data.steps.map((step) => (
                <li key={step.step}>
                  {step.step.replace(/_/g, ' ')} {ms(step.p50Ms)} median over {step.runs}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
