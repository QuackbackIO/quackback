import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { InboxFilters } from '@/components/admin/feedback/use-inbox-filters'
import type { Board, Tag, PostStatusEntity } from '@/lib/db-types'
import type { TeamMember } from '@/lib/members'

interface InboxFiltersProps {
  filters: InboxFilters
  onFiltersChange: (updates: Partial<InboxFilters>) => void
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
    <div className="border-b border-border/30 pb-4 last:border-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {title}
        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {isOpen && <div className="mt-3">{children}</div>}
    </div>
  )
}

export function InboxFiltersPanel({
  filters,
  onFiltersChange,
  boards,
  tags,
  statuses,
  members,
}: InboxFiltersProps) {
  // Simple toggle handlers - no useCallback needed for checkbox/button handlers
  const handleStatusToggle = (statusSlug: string) => {
    const currentStatuses = filters.status || []
    const newStatuses = currentStatuses.includes(statusSlug)
      ? currentStatuses.filter((s) => s !== statusSlug)
      : [...currentStatuses, statusSlug]
    onFiltersChange({ status: newStatuses.length > 0 ? newStatuses : undefined })
  }

  const handleBoardToggle = (boardId: string) => {
    const currentBoards = filters.board || []
    const newBoards = currentBoards.includes(boardId)
      ? currentBoards.filter((b) => b !== boardId)
      : [...currentBoards, boardId]
    onFiltersChange({ board: newBoards.length > 0 ? newBoards : undefined })
  }

  const handleTagToggle = (tagId: string) => {
    const currentTags = filters.tags || []
    const newTags = currentTags.includes(tagId)
      ? currentTags.filter((t) => t !== tagId)
      : [...currentTags, tagId]
    onFiltersChange({ tags: newTags.length > 0 ? newTags : undefined })
  }

  return (
    <div className="space-y-4">
      {/* Status Filter */}
      <FilterSection title="Status">
        <div className="space-y-1.5">
          {statuses.map((status) => (
            <label
              key={status.id}
              className="flex items-center gap-2.5 cursor-pointer text-sm py-0.5 group"
            >
              <Checkbox
                checked={filters.status?.includes(status.slug) || false}
                onCheckedChange={() => handleStatusToggle(status.slug)}
              />
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: status.color }}
                aria-hidden="true"
              />
              <span className="text-foreground/80 group-hover:text-foreground transition-colors">
                {status.name}
              </span>
            </label>
          ))}
        </div>
      </FilterSection>

      {/* Board Filter */}
      {boards.length > 0 && (
        <FilterSection title="Board">
          <div className="space-y-1.5">
            {boards.map((board) => (
              <label
                key={board.id}
                className="flex items-center gap-2.5 cursor-pointer text-sm py-0.5 group"
              >
                <Checkbox
                  checked={filters.board?.includes(board.id) || false}
                  onCheckedChange={() => handleBoardToggle(board.id)}
                />
                <span className="text-foreground/80 group-hover:text-foreground transition-colors truncate">
                  {board.name}
                </span>
              </label>
            ))}
          </div>
        </FilterSection>
      )}

      {/* Tags Filter */}
      {tags.length > 0 && (
        <FilterSection title="Tags" defaultOpen={true}>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const isSelected = filters.tags?.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => handleTagToggle(tag.id)}
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {tag.name}
                </button>
              )
            })}
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
      <FilterSection title="Date Range" defaultOpen={false}>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">From</label>
            <Input
              type="date"
              value={filters.dateFrom || ''}
              onChange={(e) => onFiltersChange({ dateFrom: e.target.value || undefined })}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">To</label>
            <Input
              type="date"
              value={filters.dateTo || ''}
              onChange={(e) => onFiltersChange({ dateTo: e.target.value || undefined })}
              className="h-8 text-sm"
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
            onFiltersChange({ minVotes: e.target.value ? parseInt(e.target.value, 10) : undefined })
          }
          className="h-8 text-sm"
        />
      </FilterSection>
    </div>
  )
}
