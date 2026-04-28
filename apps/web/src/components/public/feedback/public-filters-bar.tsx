import { useMemo, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import {
  TagIcon,
  CalendarIcon,
  ArrowTrendingUpIcon,
  ChatBubbleLeftRightIcon,
  PlusIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FilterChip, type FilterOption } from '@/components/shared/filter-chip'
import type { PublicFeedbackFilters } from '@/lib/shared/types'
import type { PostStatusEntity, Tag } from '@/lib/shared/db-types'
// `toggleItem` is a generic include-array helper. It currently lives in the
// admin tree but use-public-roadmap-filters.ts also imports from there.
// A future refactor should move it to components/shared/filter-utils.ts.
import { toggleItem } from '@/components/admin/feedback/filter-utils'
import {
  VOTE_THRESHOLDS,
  DATE_PRESETS,
  RESPONDED_OPTIONS,
  STATUS_CATEGORY_ORDER,
  getDateFromDaysAgo,
  type DatePresetValue,
  type RespondedValue,
} from './public-filters-bar-defaults'

type FilterCategory = 'status' | 'tag' | 'votes' | 'date' | 'response'

type IconComponent = React.ComponentType<{ className?: string }>

function CircleIcon({ className }: { className?: string }) {
  return <span className={`inline-block rounded-full bg-current ${className}`} />
}

const MENU_BUTTON_STYLES =
  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors'

interface MenuButtonProps {
  onClick: () => void
  children: React.ReactNode
  className?: string
}

function MenuButton({ onClick, children, className }: MenuButtonProps) {
  return (
    <button type="button" onClick={onClick} className={cn(MENU_BUTTON_STYLES, className)}>
      {children}
    </button>
  )
}

interface PublicFiltersBarProps {
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  clearFilters: () => void
  statuses: PostStatusEntity[]
  tags: Tag[]
}

export function PublicFiltersBar({
  filters,
  setFilters,
  clearFilters,
  statuses,
  tags,
}: PublicFiltersBarProps) {
  const intl = useIntl()
  const showHidingHint = !filters.status?.length

  const handleShowAll = () => {
    setFilters({ status: statuses.map((s) => s.slug) })
  }

  const activeChips = useMemo(
    () => buildActiveChips({ filters, setFilters, statuses, tags, intl }),
    [filters, setFilters, statuses, tags, intl]
  )

  return (
    <div className="bg-card/50" role="region" aria-label="Active filters">
      <div className="flex flex-wrap gap-1 items-center">
        {activeChips.map(({ key, type, ...chipProps }) => (
          <FilterChip key={key} icon={getIconForType(type)} {...chipProps} />
        ))}

        <AddFilterButton
          filters={filters}
          setFilters={setFilters}
          statuses={statuses}
          tags={tags}
        />

        {activeChips.length >= 2 && (
          <button
            type="button"
            onClick={clearFilters}
            className={cn(
              'text-[11px] text-muted-foreground hover:text-foreground',
              'px-1.5 py-0.5 rounded',
              'hover:bg-muted/50',
              'transition-colors'
            )}
          >
            <FormattedMessage id="portal.feedback.filter.clearAll" defaultMessage="Clear all" />
          </button>
        )}
      </div>

      {showHidingHint && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>
            <FormattedMessage
              id="portal.feedback.filter.hidingCompleted"
              defaultMessage="Hiding completed and closed posts."
            />
          </span>
          <button
            type="button"
            onClick={handleShowAll}
            className="underline hover:text-foreground transition-colors"
          >
            <FormattedMessage id="portal.feedback.filter.showAll" defaultMessage="Show all" />
          </button>
        </div>
      )}
    </div>
  )
}

interface AddFilterButtonProps {
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  statuses: PostStatusEntity[]
  tags: Tag[]
}

function AddFilterButton({ filters, setFilters, statuses, tags }: AddFilterButtonProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<FilterCategory | null>(null)

  const closePopover = () => {
    setOpen(false)
    setActiveCategory(null)
  }

  const categories: { key: FilterCategory; label: string; icon: IconComponent }[] = [
    {
      key: 'status',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.category.status',
        defaultMessage: 'Status',
      }),
      icon: CircleIcon,
    },
    {
      key: 'tag',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.category.tag',
        defaultMessage: 'Tag',
      }),
      icon: TagIcon,
    },
    {
      key: 'votes',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.category.votes',
        defaultMessage: 'Vote count',
      }),
      icon: ArrowTrendingUpIcon,
    },
    {
      key: 'date',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.category.date',
        defaultMessage: 'Created date',
      }),
      icon: CalendarIcon,
    },
    {
      key: 'response',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.category.response',
        defaultMessage: 'Team response',
      }),
      icon: ChatBubbleLeftRightIcon,
    },
  ]

  const groupedStatuses = useMemo(() => {
    const groups: Record<string, PostStatusEntity[]> = {}
    for (const cat of STATUS_CATEGORY_ORDER) groups[cat] = []
    for (const s of statuses) {
      const cat = (s.category ?? 'active') as string
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(s)
    }
    return groups
  }, [statuses])

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) setActiveCategory(null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5',
            'rounded-full text-xs',
            'border border-dashed border-border/50',
            'text-muted-foreground hover:text-foreground',
            'hover:border-border hover:bg-muted/30',
            'transition-colors'
          )}
        >
          <PlusIcon className="h-3 w-3" />
          <FormattedMessage id="portal.feedback.filter.addFilter" defaultMessage="Add filter" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-0">
        {activeCategory === null ? (
          <div className="py-1">
            {categories.map((category) => {
              const Icon = category.icon
              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setActiveCategory(category.key)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-2.5 py-1.5',
                    'text-xs text-left',
                    'hover:bg-muted/50 transition-colors'
                  )}
                  aria-label={category.label}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {category.label}
                  </span>
                  <ChevronRightIcon className="h-3 w-3 text-muted-foreground" />
                </button>
              )
            })}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground border-b border-border/50"
            >
              <ChevronRightIcon className="h-2.5 w-2.5 rotate-180" />
              <FormattedMessage id="portal.feedback.filter.back" defaultMessage="Back" />
            </button>
            <div className="max-h-[250px] overflow-y-auto py-1">
              {activeCategory === 'status' &&
                STATUS_CATEGORY_ORDER.map((cat) => {
                  const list = groupedStatuses[cat] ?? []
                  if (list.length === 0) return null
                  return (
                    <div key={cat}>
                      <div className="px-2.5 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <FormattedMessage
                          id={`portal.feedback.filter.statusGroup.${cat}`}
                          defaultMessage={cat[0].toUpperCase() + cat.slice(1)}
                        />
                      </div>
                      {list.map((status) => (
                        <MenuButton
                          key={status.id}
                          onClick={() => {
                            setFilters({ status: toggleItem(filters.status, status.slug) })
                            closePopover()
                          }}
                        >
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: status.color }}
                          />
                          {status.name}
                        </MenuButton>
                      ))}
                    </div>
                  )
                })}

              {activeCategory === 'tag' &&
                tags.map((tag) => (
                  <MenuButton
                    key={tag.id}
                    onClick={() => {
                      setFilters({ tagIds: toggleItem(filters.tagIds, tag.id) })
                      closePopover()
                    }}
                  >
                    {tag.name}
                  </MenuButton>
                ))}

              {activeCategory === 'votes' &&
                VOTE_THRESHOLDS.map((t) => (
                  <MenuButton
                    key={t.value}
                    onClick={() => {
                      setFilters({ minVotes: t.value })
                      closePopover()
                    }}
                  >
                    {t.label}
                  </MenuButton>
                ))}

              {activeCategory === 'date' &&
                DATE_PRESETS.map((p) => (
                  <MenuButton
                    key={p.value}
                    onClick={() => {
                      setFilters({ dateFrom: getDateFromDaysAgo(p.daysAgo) })
                      closePopover()
                    }}
                  >
                    {p.label}
                  </MenuButton>
                ))}

              {activeCategory === 'response' &&
                RESPONDED_OPTIONS.map((opt) => (
                  <MenuButton
                    key={opt.value}
                    onClick={() => {
                      setFilters({ responded: opt.value })
                      closePopover()
                    }}
                  >
                    {opt.label}
                  </MenuButton>
                ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface ActiveChipDescriptor {
  key: string
  type: 'status' | 'tags' | 'votes' | 'date' | 'response'
  label: string
  value: string
  valueId: string
  color?: string
  options?: FilterOption[]
  onChange?: (newId: string) => void
  onRemove: () => void
}

function buildActiveChips(args: {
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  statuses: PostStatusEntity[]
  tags: Tag[]
  intl: ReturnType<typeof useIntl>
}): ActiveChipDescriptor[] {
  const { filters, setFilters, statuses, tags, intl } = args
  const chips: ActiveChipDescriptor[] = []

  const statusOptions: FilterOption[] = statuses.map((s) => ({
    id: s.slug,
    label: s.name,
    color: s.color,
  }))

  // Status chips — one per selected slug
  if (filters.status?.length) {
    for (const slug of filters.status) {
      const status = statuses.find((s) => s.slug === slug)
      if (!status) continue
      chips.push({
        key: `status-${slug}`,
        type: 'status',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.chip.status',
          defaultMessage: 'Status:',
        }),
        value: status.name,
        valueId: slug,
        color: status.color,
        options: statusOptions,
        onChange: (newSlug) => {
          const others = filters.status?.filter((s) => s !== slug) ?? []
          setFilters({ status: [...others, newSlug] })
        },
        onRemove: () => {
          const next = filters.status?.filter((s) => s !== slug)
          setFilters({ status: next?.length ? next : undefined })
        },
      })
    }
  }

  // Tags — 1-2 individual, 3+ combined
  if (filters.tagIds?.length) {
    const tagOptions: FilterOption[] = tags.map((t) => ({ id: t.id, label: t.name }))
    if (filters.tagIds.length <= 2) {
      for (const id of filters.tagIds) {
        const tag = tags.find((t) => t.id === id)
        if (!tag) continue
        chips.push({
          key: `tag-${id}`,
          type: 'tags',
          label: intl.formatMessage({
            id: 'portal.feedback.filter.chip.tag',
            defaultMessage: 'Tag:',
          }),
          value: tag.name,
          valueId: id,
          options: tagOptions,
          onChange: (newId) => {
            const others = filters.tagIds?.filter((t) => t !== id) ?? []
            setFilters({ tagIds: [...others, newId] })
          },
          onRemove: () => {
            const next = filters.tagIds?.filter((t) => t !== id)
            setFilters({ tagIds: next?.length ? next : undefined })
          },
        })
      }
    } else {
      const names = filters.tagIds
        .map((id) => tags.find((t) => t.id === id)?.name)
        .filter((n): n is string => !!n)
      chips.push({
        key: 'tags-combined',
        type: 'tags',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.chip.tags',
          defaultMessage: 'Tags:',
        }),
        value: `${names.slice(0, 2).join(', ')} +${names.length - 2}`,
        valueId: 'combined',
        onRemove: () => setFilters({ tagIds: undefined }),
      })
    }
  }

  // Vote count
  if (filters.minVotes) {
    const opts: FilterOption[] = VOTE_THRESHOLDS.map((t) => ({
      id: String(t.value),
      label: t.label,
    }))
    const matched = VOTE_THRESHOLDS.find((t) => t.value === filters.minVotes)
    chips.push({
      key: 'minVotes',
      type: 'votes',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.votes',
        defaultMessage: 'Min votes:',
      }),
      value: matched ? matched.label : `${filters.minVotes}+`,
      valueId: String(filters.minVotes),
      options: opts,
      onChange: (id) => setFilters({ minVotes: parseInt(id, 10) }),
      onRemove: () => setFilters({ minVotes: undefined }),
    })
  }

  // Created date
  if (filters.dateFrom) {
    const opts: FilterOption[] = DATE_PRESETS.map((p) => ({ id: p.value, label: p.label }))
    const matched = DATE_PRESETS.find((p) => getDateFromDaysAgo(p.daysAgo) === filters.dateFrom)
    chips.push({
      key: 'dateFrom',
      type: 'date',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.date',
        defaultMessage: 'Date:',
      }),
      value: matched ? matched.label : filters.dateFrom,
      valueId: matched?.value ?? filters.dateFrom,
      options: opts,
      onChange: (presetId) => {
        const preset = DATE_PRESETS.find((p) => p.value === (presetId as DatePresetValue))
        if (preset) setFilters({ dateFrom: getDateFromDaysAgo(preset.daysAgo) })
      },
      onRemove: () => setFilters({ dateFrom: undefined }),
    })
  }

  // Team response
  if (filters.responded) {
    const opts: FilterOption[] = RESPONDED_OPTIONS.map((o) => ({ id: o.value, label: o.label }))
    const matched = RESPONDED_OPTIONS.find((o) => o.value === filters.responded)
    chips.push({
      key: 'responded',
      type: 'response',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.response',
        defaultMessage: 'Team response:',
      }),
      value: matched?.label ?? filters.responded,
      valueId: filters.responded,
      options: opts,
      onChange: (id) => setFilters({ responded: id as RespondedValue }),
      onRemove: () => setFilters({ responded: undefined }),
    })
  }

  return chips
}

function getIconForType(type: ActiveChipDescriptor['type']): IconComponent {
  const map: Record<ActiveChipDescriptor['type'], IconComponent> = {
    status: CircleIcon,
    tags: TagIcon,
    votes: ArrowTrendingUpIcon,
    date: CalendarIcon,
    response: ChatBubbleLeftRightIcon,
  }
  return map[type]
}
