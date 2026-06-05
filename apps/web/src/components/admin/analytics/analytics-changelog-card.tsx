import { AnalyticsBarList } from './analytics-bar-list'
import { AnalyticsEmpty } from './analytics-empty'

interface ChangelogCardProps {
  topEntries: Array<{ id: string; title: string; viewCount: number }>
}

export function AnalyticsChangelogCard({ topEntries }: ChangelogCardProps) {
  if (topEntries.length === 0) {
    return <AnalyticsEmpty message="No changelog entries yet" />
  }

  return (
    <AnalyticsBarList
      header={{ label: 'Entry', value: 'Views' }}
      rows={topEntries.map((entry) => ({
        key: entry.id,
        label: entry.title,
        value: entry.viewCount,
        display: entry.viewCount.toLocaleString(),
      }))}
    />
  )
}
