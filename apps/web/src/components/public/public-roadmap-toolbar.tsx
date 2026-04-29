import { useEffect, useState } from 'react'
import { useIntl, FormattedMessage } from 'react-intl'
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type RoadmapSort = 'votes' | 'newest' | 'oldest'

interface PublicRoadmapToolbarProps {
  currentSort: RoadmapSort
  onSortChange: (sort: RoadmapSort) => void
  currentSearch?: string
  onSearchChange: (search: string | undefined) => void
  /** Optional slot rendered after the search button on the right (typically the Filter button). */
  filterButton?: React.ReactNode
}

export function PublicRoadmapToolbar({
  currentSort,
  onSortChange,
  currentSearch,
  onSearchChange,
  filterButton,
}: PublicRoadmapToolbarProps): React.ReactElement {
  const intl = useIntl()
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState(currentSearch ?? '')

  // Keep local input value in sync when filter cleared from elsewhere
  useEffect(() => {
    setSearchValue(currentSearch ?? '')
  }, [currentSearch])

  const handleSearchSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    onSearchChange(searchValue.trim() || undefined)
    setSearchOpen(false)
  }

  const handleClearSearch = (): void => {
    setSearchValue('')
    onSearchChange(undefined)
    setSearchOpen(false)
  }

  const sortOptions: ComboboxOption<RoadmapSort>[] = [
    {
      value: 'votes',
      label: intl.formatMessage({
        id: 'portal.roadmap.toolbar.sortVotes',
        defaultMessage: 'Most votes',
      }),
    },
    {
      value: 'newest',
      label: intl.formatMessage({
        id: 'portal.roadmap.toolbar.sortNewest',
        defaultMessage: 'Newest',
      }),
    },
    {
      value: 'oldest',
      label: intl.formatMessage({
        id: 'portal.roadmap.toolbar.sortOldest',
        defaultMessage: 'Oldest',
      }),
    },
  ]

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
      {/* Sort */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          <FormattedMessage id="portal.roadmap.toolbar.sortBy" defaultMessage="Sort by" />
        </span>
        <Combobox
          value={currentSort}
          onValueChange={onSortChange}
          options={sortOptions}
          size="sm"
          className="w-[140px]"
        />
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 justify-between sm:justify-end w-full sm:w-auto">
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <MagnifyingGlassIcon className="h-4 w-4" />
              <span className="hidden sm:inline">
                <FormattedMessage id="portal.feedback.toolbar.search" defaultMessage="Search" />
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="max-w-[calc(100vw-2rem)] sm:w-80" align="end">
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <Input
                placeholder={intl.formatMessage({
                  id: 'portal.feedback.toolbar.searchPlaceholder',
                  defaultMessage: 'Search posts...',
                })}
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="flex-1"
                autoFocus
              />
              <Button type="submit" size="sm">
                <FormattedMessage
                  id="portal.feedback.toolbar.searchSubmit"
                  defaultMessage="Search"
                />
              </Button>
            </form>
            {currentSearch && (
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={handleClearSearch}>
                <FormattedMessage
                  id="portal.feedback.toolbar.clearSearch"
                  defaultMessage="Clear search"
                />
              </Button>
            )}
          </PopoverContent>
        </Popover>

        {filterButton}
      </div>
    </div>
  )
}
