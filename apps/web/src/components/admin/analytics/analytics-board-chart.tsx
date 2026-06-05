import { useMemo } from 'react'
import { AnalyticsBarList } from './analytics-bar-list'
import { AnalyticsEmpty } from './analytics-empty'

interface BoardChartProps {
  data: Array<{ board: string; count: number }>
}

export function AnalyticsBoardChart({ data }: BoardChartProps) {
  const sorted = useMemo(() => [...data].sort((a, b) => b.count - a.count), [data])

  if (sorted.length === 0) {
    return <AnalyticsEmpty message="No data for this period" />
  }

  return (
    <AnalyticsBarList
      header={{ label: 'Board', value: 'Posts' }}
      rows={sorted.map((item, i) => ({
        // Board names aren't guaranteed unique, so disambiguate with the index.
        key: `${item.board}-${i}`,
        label: item.board,
        value: item.count,
      }))}
    />
  )
}
