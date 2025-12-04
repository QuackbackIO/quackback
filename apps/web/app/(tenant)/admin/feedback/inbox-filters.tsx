'use client'

import { useState, useCallback } from 'react'
import { X, ChevronDown, ChevronUp } from 'lucide-react'
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
import type { InboxFilters } from './use-inbox-filters'
import type { PostStatus, Board, Tag, PostStatusEntity } from '@quackback/db'

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
  statuses: PostStatusEntity[]
  members: TeamMember[]
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
  statuses,
  members,
}: InboxFiltersProps) {
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
          {statuses.map((status) => (
            <label key={status.id} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={filters.status?.includes(status.slug as PostStatus) || false}
                onCheckedChange={() => handleStatusToggle(status.slug as PostStatus)}
              />
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: status.color }}
                aria-hidden="true"
              />
              <span className="text-foreground">{status.name}</span>
            </label>
          ))}
        </div>
      </FilterSection>

      {/* Board Filter */}
      {boards.length > 0 && (
        <FilterSection title="Board">
          <div className="space-y-2">
            {boards.map((board) => (
              <label key={board.id} className="flex items-center gap-2 cursor-pointer text-sm">
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
        <FilterSection title="Tags" defaultOpen={true}>
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
        <FilterSection title="Assigned To" defaultOpen={true}>
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
      <FilterSection title="Date Range" defaultOpen={true}>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input
              type="date"
              value={filters.dateFrom || ''}
              onChange={(e) => onFiltersChange({ dateFrom: e.target.value || undefined })}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input
              type="date"
              value={filters.dateTo || ''}
              onChange={(e) => onFiltersChange({ dateTo: e.target.value || undefined })}
              className="mt-1"
            />
          </div>
        </div>
      </FilterSection>

      {/* Min Votes Filter */}
      <FilterSection title="Minimum Votes" defaultOpen={true}>
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
