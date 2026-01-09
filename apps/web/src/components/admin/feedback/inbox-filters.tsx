import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { StatusFilterList, BoardFilterList } from './single-select-filter-list'
import type { InboxFilters } from '@/components/admin/feedback/use-inbox-filters'
import type { Board, Tag, PostStatusEntity } from '@/lib/db-types'

interface InboxFiltersProps {
  filters: InboxFilters
  onFiltersChange: (updates: Partial<InboxFilters>) => void
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
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
}: InboxFiltersProps) {
  // Get current single-select values from filters
  // If multiple statuses/boards are selected (from URL), take the first one for sidebar display
  const selectedStatusSlug = filters.status?.length === 1 ? filters.status[0] : undefined
  const selectedBoardId = filters.board?.length === 1 ? filters.board[0] : undefined

  const handleStatusSelect = (slug: string | undefined) => {
    onFiltersChange({ status: slug ? [slug] : undefined })
  }

  const handleBoardSelect = (id: string | undefined) => {
    onFiltersChange({ board: id ? [id] : undefined })
  }

  // Tag toggle (multi-select, kept as-is)
  const handleTagToggle = (tagId: string) => {
    const currentTags = filters.tags || []
    const newTags = currentTags.includes(tagId)
      ? currentTags.filter((t) => t !== tagId)
      : [...currentTags, tagId]
    onFiltersChange({ tags: newTags.length > 0 ? newTags : undefined })
  }

  return (
    <div className="space-y-4">
      {/* Status Filter - Single Select */}
      <FilterSection title="Status">
        <StatusFilterList
          statuses={statuses.map((s) => ({
            id: s.id,
            slug: s.slug,
            name: s.name,
            color: s.color,
          }))}
          selectedSlug={selectedStatusSlug}
          onSelect={handleStatusSelect}
        />
        {/* Show indicator if multiple statuses are selected via URL/advanced filter */}
        {filters.status && filters.status.length > 1 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {filters.status.length} statuses selected via advanced filters
          </p>
        )}
      </FilterSection>

      {/* Board Filter - Single Select */}
      {boards.length > 0 && (
        <FilterSection title="Board">
          <BoardFilterList
            boards={boards}
            selectedId={selectedBoardId}
            onSelect={handleBoardSelect}
          />
          {/* Show indicator if multiple boards are selected via URL/advanced filter */}
          {filters.board && filters.board.length > 1 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {filters.board.length} boards selected via advanced filters
            </p>
          )}
        </FilterSection>
      )}

      {/* Tags Filter - Multi-select chips */}
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
    </div>
  )
}
