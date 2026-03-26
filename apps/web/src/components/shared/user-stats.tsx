'use client'

import { useQuery } from '@tanstack/react-query'
import { LightBulbIcon, ChatBubbleLeftIcon } from '@heroicons/react/24/outline'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { getUserStatsFn } from '@/lib/server/functions/user'
import { cn } from '@/lib/shared/utils'

function StatItem({
  icon: Icon,
  value,
  label,
  compact,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: number | undefined
  label: string
  compact?: boolean
}) {
  return (
    <div className="flex flex-col items-center">
      <span
        className={cn('font-bold tabular-nums text-foreground', compact ? 'text-sm' : 'text-lg')}
      >
        {value ?? '-'}
      </span>
      <div className="flex items-center gap-0.5 mt-0.5">
        <Icon className={cn('text-muted-foreground', compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
        <span className={cn('text-muted-foreground', compact ? 'text-[10px]' : 'text-xs')}>
          {label}
        </span>
      </div>
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
    <div className={cn('flex items-center justify-around', className)}>
      <StatItem icon={LightBulbIcon} value={data?.ideas} label="Ideas" compact={compact} />
      <div className={cn('w-px bg-border', compact ? 'h-6' : 'h-8')} />
      <StatItem icon={ChevronUpIcon} value={data?.votes} label="Votes" compact={compact} />
      <div className={cn('w-px bg-border', compact ? 'h-6' : 'h-8')} />
      <StatItem
        icon={ChatBubbleLeftIcon}
        value={data?.comments}
        label="Comments"
        compact={compact}
      />
    </div>
  )
}
