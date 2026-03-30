'use client'

import { useQuery } from '@tanstack/react-query'
import { getUserStatsFn } from '@/lib/server/functions/user'
import { cn } from '@/lib/shared/utils'

function StatItem({
  value,
  label,
  compact,
}: {
  value: number | undefined
  label: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-md bg-muted/40',
        compact ? 'py-1.5 px-1' : 'py-2 px-2'
      )}
    >
      <span
        className={cn('font-bold tabular-nums text-foreground', compact ? 'text-sm' : 'text-lg')}
      >
        {value ?? '-'}
      </span>
      <span className={cn('text-muted-foreground mt-0.5', compact ? 'text-[10px]' : 'text-xs')}>
        {label}
      </span>
    </div>
  )
}

interface UserStatsBarProps {
  compact?: boolean
  className?: string
  headers?: Record<string, string>
}

export function UserStatsBar({ compact, className, headers }: UserStatsBarProps) {
  const { data } = useQuery({
    queryKey: headers ? ['widget', 'user', 'engagement-stats'] : ['user', 'engagement-stats'],
    queryFn: () => getUserStatsFn(headers ? { headers } : undefined),
    staleTime: 60 * 1000,
  })

  return (
    <div className={cn('grid grid-cols-3 gap-1', className)}>
      <StatItem value={data?.ideas} label="Ideas" compact={compact} />
      <StatItem value={data?.votes} label="Votes" compact={compact} />
      <StatItem value={data?.comments} label="Comments" compact={compact} />
    </div>
  )
}
