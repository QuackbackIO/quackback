import { AnalyticsAreaChart } from './analytics-area-chart'
import type { MetricKey } from './analytics-summary-cards'

interface ActivityChartProps {
  dailyStats: Array<{ date: string; posts: number; votes: number; comments: number; users: number }>
  activeMetric: MetricKey
}

export function AnalyticsActivityChart({ dailyStats, activeMetric }: ActivityChartProps) {
  return (
    <AnalyticsAreaChart
      data={dailyStats}
      dataKey={activeMetric}
      // Capitalize the metric key so the tooltip reads "Posts", not "posts".
      label={activeMetric[0].toUpperCase() + activeMetric.slice(1)}
      metric={activeMetric}
    />
  )
}
