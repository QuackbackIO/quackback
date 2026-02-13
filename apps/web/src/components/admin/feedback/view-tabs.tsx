import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/feedback'
import {
  ListBulletIcon,
  ArrowTrendingUpIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
} from '@heroicons/react/24/solid'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import type { InboxFilters } from '@/lib/shared/types'
import { cn } from '@/lib/shared/utils'

interface ViewTabsProps {
  statuses: PostStatusEntity[]
}

interface ViewPreset {
  id: string
  label: string
  icon: typeof ListBulletIcon
  /** Keys in InboxFilters that identify this preset when present in the URL */
  matchKeys: (keyof InboxFilters)[]
  getFilters: (statuses: PostStatusEntity[]) => Partial<InboxFilters>
}

const VIEW_PRESETS: ViewPreset[] = [
  {
    id: 'all',
    label: 'All',
    icon: ListBulletIcon,
    matchKeys: [],
    getFilters: () => ({}),
  },
  {
    id: 'top-voted',
    label: 'Top Voted',
    icon: ArrowTrendingUpIcon,
    matchKeys: ['sort'],
    getFilters: () => ({ sort: 'votes' }),
  },
  {
    id: 'unresponded',
    label: 'Unresponded',
    icon: ChatBubbleLeftRightIcon,
    matchKeys: ['responded'],
    getFilters: () => ({ responded: 'unresponded' }),
  },
  {
    id: 'stale',
    label: 'Stale',
    icon: ClockIcon,
    matchKeys: ['updatedBefore'],
    getFilters: (statuses) => {
      const activeSlugs = statuses
        .filter((s) => s.category === 'active' && !s.isDefault && !s.deletedAt)
        .map((s) => s.slug)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      return {
        status: activeSlugs.length > 0 ? activeSlugs : undefined,
        updatedBefore: thirtyDaysAgo,
      }
    },
  },
]

function isPresetActive(preset: ViewPreset, search: Record<string, unknown>): boolean {
  if (preset.matchKeys.length === 0) {
    return !VIEW_PRESETS.some((p) => p.matchKeys.length > 0 && isPresetActive(p, search))
  }

  return preset.matchKeys.some((key) => {
    const value = search[key]
    return value !== undefined && value !== 'newest' && value !== 'all'
  })
}

export function ViewTabs({ statuses }: ViewTabsProps) {
  const navigate = useNavigate()
  const search = Route.useSearch()

  return (
    <div className="flex items-center gap-1">
      {VIEW_PRESETS.map((preset) => {
        const Icon = preset.icon
        const isActive = isPresetActive(preset, search)

        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              const filters = preset.getFilters(statuses)
              void navigate({
                to: '/admin/feedback',
                search: {
                  sort: filters.sort ?? 'newest',
                  responded: filters.responded,
                  status: filters.status,
                  updatedBefore: filters.updatedBefore,
                },
                replace: true,
              })
            }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors cursor-pointer',
              isActive
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <Icon className={cn('h-3.5 w-3.5', isActive && 'text-primary')} />
            {preset.label}
          </button>
        )
      })}
    </div>
  )
}
