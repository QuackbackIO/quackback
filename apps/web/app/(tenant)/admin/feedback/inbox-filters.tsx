'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, X, ChevronDown, ChevronUp } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { cn } from '@/lib/utils'
import type { InboxFilters } from './use-inbox-filters'
import type { PostStatus, Board, Tag } from '@quackback/db'

const STATUS_OPTIONS: { value: PostStatus; label: string; color: string }[] = [
  { value: 'open', label: 'Open', color: 'bg-blue-500' },
  { value: 'under_review', label: 'Under Review', color: 'bg-yellow-500' },
  { value: 'planned', label: 'Planned', color: 'bg-purple-500' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-orange-500' },
  { value: 'complete', label: 'Complete', color: 'bg-green-500' },
  { value: 'closed', label: 'Closed', color: 'bg-gray-500' },
]

interface TeamMember {
  id: string
  name: string
  email: string
  image?: string | null
}

interface InboxFiltersProps {
  filters: InboxFilters
  onFiltersChange: (updates: Partial<InboxFilters>) => void
  onClearFilters: () => void
  hasActiveFilters: boolean
  boards: Board[]
  tags: Tag[]
  members: TeamMember[]
  headerAction?: React.ReactNode
}

function FilterSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-border pb-4 last:border-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-2 text-sm font-medium text-foreground hover:text-foreground/80"
      >
        {title}
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {isOpen && <div className="mt-2">{children}</div>}
    </div>
  )
}

export function InboxFiltersPanel({
  filters,
  onFiltersChange,
  onClearFilters,
  hasActiveFilters,
  boards,
  tags,
  members,
  headerAction,
}: InboxFiltersProps) {
  const [searchValue, setSearchValue] = useState(filters.search || '')
  const debouncedSearch = useDebounce(searchValue, 300)
  const isInitialMount = useRef(true)
  const lastSyncedSearch = useRef(filters.search)

  // Sync search input when URL changes externally (e.g., clear filters)
  useEffect(() => {
    if (filters.search !== lastSyncedSearch.current) {
      setSearchValue(filters.search || '')
      lastSyncedSearch.current = filters.search
    }
  }, [filters.search])

  // Update filters when debounced search changes (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    if (debouncedSearch !== lastSyncedSearch.current) {
      lastSyncedSearch.current = debouncedSearch || undefined
      onFiltersChange({ search: debouncedSearch || undefined })
    }
  }, [debouncedSearch, onFiltersChange])

  const handleStatusToggle = useCallback(
    (status: PostStatus) => {
      const currentStatuses = filters.status || []
      const newStatuses = currentStatuses.includes(status)
        ? currentStatuses.filter((s) => s !== status)
        : [...currentStatuses, status]
      onFiltersChange({ status: newStatuses.length > 0 ? newStatuses : undefined })
    },
    [filters.status, onFiltersChange]
  )

  const handleBoardToggle = useCallback(
    (boardId: string) => {
      const currentBoards = filters.board || []
      const newBoards = currentBoards.includes(boardId)
        ? currentBoards.filter((b) => b !== boardId)
        : [...currentBoards, boardId]
      onFiltersChange({ board: newBoards.length > 0 ? newBoards : undefined })
    },
    [filters.board, onFiltersChange]
  )

  const handleTagToggle = useCallback(
    (tagId: string) => {
      const currentTags = filters.tags || []
      const newTags = currentTags.includes(tagId)
        ? currentTags.filter((t) => t !== tagId)
        : [...currentTags, tagId]
      onFiltersChange({ tags: newTags.length > 0 ? newTags : undefined })
    },
    [filters.tags, onFiltersChange]
  )

  return (
    <div className="space-y-4">
      {/* Search + Create */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="pl-9 pr-9"
            data-search-input
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => setSearchValue('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {headerAction}
      </div>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="w-full">
          <X className="h-4 w-4 mr-2" />
          Clear all filters
        </Button>
      )}

      {/* Status Filter */}
      <FilterSection title="Status">
        <div className="space-y-2">
          {STATUS_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 cursor-pointer text-sm"
            >
              <Checkbox
                checked={filters.status?.includes(option.value) || false}
                onCheckedChange={() => handleStatusToggle(option.value)}
              />
              <span
                className={cn('h-2 w-2 rounded-full', option.color)}
                aria-hidden="true"
              />
              <span className="text-foreground">{option.label}</span>
            </label>
          ))}
        </div>
      </FilterSection>

      {/* Board Filter */}
      {boards.length > 0 && (
        <FilterSection title="Board">
          <div className="space-y-2">
            {boards.map((board) => (
              <label
                key={board.id}
                className="flex items-center gap-2 cursor-pointer text-sm"
              >
                <Checkbox
                  checked={filters.board?.includes(board.id) || false}
                  onCheckedChange={() => handleBoardToggle(board.id)}
                />
                <span className="text-foreground truncate">{board.name}</span>
              </label>
            ))}
          </div>
        </FilterSection>
      )}

      {/* Tags Filter */}
      {tags.length > 0 && (
        <FilterSection title="Tags" defaultOpen={false}>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge
                key={tag.id}
                variant={filters.tags?.includes(tag.id) ? 'default' : 'outline'}
                className="cursor-pointer"
                style={
                  filters.tags?.includes(tag.id)
                    ? { backgroundColor: tag.color, borderColor: tag.color }
                    : { borderColor: tag.color, color: tag.color }
                }
                onClick={() => handleTagToggle(tag.id)}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        </FilterSection>
      )}

      {/* Owner Filter */}
      {members.length > 0 && (
        <FilterSection title="Assigned To" defaultOpen={false}>
          <Select
            value={filters.owner || 'all'}
            onValueChange={(value) =>
              onFiltersChange({ owner: value === 'all' ? undefined : value })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Anyone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Anyone</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name || member.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSection>
      )}

      {/* Date Range Filter */}
      <FilterSection title="Date Range" defaultOpen={false}>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input
              type="date"
              value={filters.dateFrom || ''}
              onChange={(e) =>
                onFiltersChange({ dateFrom: e.target.value || undefined })
              }
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input
              type="date"
              value={filters.dateTo || ''}
              onChange={(e) =>
                onFiltersChange({ dateTo: e.target.value || undefined })
              }
              className="mt-1"
            />
          </div>
        </div>
      </FilterSection>

      {/* Min Votes Filter */}
      <FilterSection title="Minimum Votes" defaultOpen={false}>
        <Input
          type="number"
          min={0}
          placeholder="0"
          value={filters.minVotes || ''}
          onChange={(e) =>
            onFiltersChange({
              minVotes: e.target.value ? parseInt(e.target.value, 10) : undefined,
            })
          }
        />
      </FilterSection>
    </div>
  )
}
