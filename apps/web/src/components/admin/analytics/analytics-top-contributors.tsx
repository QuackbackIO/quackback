import { Avatar } from '@/components/ui/avatar'
import { AnalyticsBarList } from './analytics-bar-list'
import { AnalyticsEmpty } from './analytics-empty'

interface TopContributorsProps {
  contributors: Array<{
    principalId: string
    displayName: string | null
    avatarUrl: string | null
    posts: number
    votes: number
    comments: number
    total: number
  }>
}

export function AnalyticsTopContributors({ contributors }: TopContributorsProps) {
  if (contributors.length === 0) {
    return <AnalyticsEmpty message="No contributor activity in this period" />
  }

  return (
    <AnalyticsBarList
      header={{ label: 'Contributor', value: 'Activity' }}
      rows={contributors.map((c) => ({
        key: c.principalId,
        value: c.total,
        leading: (
          <Avatar
            src={c.avatarUrl}
            name={c.displayName}
            className="relative size-5 shrink-0 text-[10px]"
          />
        ),
        label: <span className="block truncate">{c.displayName ?? 'Anonymous'}</span>,
      }))}
    />
  )
}
