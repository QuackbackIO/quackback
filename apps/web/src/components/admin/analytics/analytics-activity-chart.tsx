import { AnalyticsAreaChart } from './analytics-area-chart'
import type { MetricKey } from './analytics-summary-cards'

interface ActivityChartProps {
  dailyStats: Array<{ date: string; posts: number; votes: number; comments: number; users: number }>
  activeMetric: MetricKey
}

const CHART_BINDINGS: Record<MetricKey, { dataKey: string; metric: string; label: string }> = {
  posts: { dataKey: 'posts', metric: 'posts', label: 'Posts' },
  votes: { dataKey: 'votes', metric: 'votes', label: 'Votes' },
  // The metric key is 'postComments' but the daily rows and the color token
  // are both named 'comments'.
  postComments: { dataKey: 'comments', metric: 'comments', label: 'Comments' },
  users: { dataKey: 'users', metric: 'users', label: 'Users' },
}

export function AnalyticsActivityChart({ dailyStats, activeMetric }: ActivityChartProps) {
  const { dataKey, metric, label } = CHART_BINDINGS[activeMetric]
  return <AnalyticsAreaChart data={dailyStats} dataKey={dataKey} label={label} metric={metric} />
}
