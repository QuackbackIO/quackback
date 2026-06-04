import { AnalyticsBarList } from './analytics-bar-list'
import { AnalyticsEmpty } from './analytics-empty'

interface ChangelogCardProps {
  topEntries: Array<{ id: string; title: string; viewCount: number }>
  totalViews: number
}

export function AnalyticsChangelogCard({ topEntries, totalViews }: ChangelogCardProps) {
  if (topEntries.length === 0) {
    return <AnalyticsEmpty message="No changelog entries yet" />
  }

  return (
    <div>
      <AnalyticsBarList
        header={{ label: 'Entry', value: 'Views' }}
        rows={topEntries.map((entry) => ({
          key: entry.id,
          label: <span className="block truncate">{entry.title}</span>,
          value: entry.viewCount,
          display: entry.viewCount.toLocaleString(),
        }))}
      />
      <p className="mt-3 text-right text-xs text-muted-foreground">
        {totalViews.toLocaleString()} total views
      </p>
    </div>
  )
}
