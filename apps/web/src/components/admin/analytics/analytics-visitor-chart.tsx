import { AnalyticsAreaChart } from './analytics-area-chart'
import { VISITOR_METRICS, type VisitorMetricKey } from './analytics-visitor-cards'

interface VisitorChartProps {
  dailyStats: Array<{ date: string; uniqueVisitors: number; pageviews: number; visits: number }>
  activeMetric: VisitorMetricKey
}

export function AnalyticsVisitorChart({ dailyStats, activeMetric }: VisitorChartProps) {
  const metric = VISITOR_METRICS.find((m) => m.key === activeMetric) ?? VISITOR_METRICS[0]
  return (
    <AnalyticsAreaChart
      data={dailyStats}
      dataKey={metric.dataKey}
      label={metric.label}
      metric={metric.key}
    />
  )
}
