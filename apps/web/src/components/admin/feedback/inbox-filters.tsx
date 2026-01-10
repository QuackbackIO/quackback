import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/solid'
import { StatusFilterList, BoardFilterList } from './single-select-filter-list'
import { toggleItem } from './filter-utils'
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
  hint,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  hint?: string
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="pb-4 last:pb-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {title}
        {isOpen ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
      </button>
      {isOpen && (
        <div className="mt-2">
          {children}
          {hint && <p className="mt-2 text-[10px] text-muted-foreground/60">{hint}</p>}
        </div>
      )}
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
  // Handle filter selection with multi-select support
  // - Regular click: select only this item (replace), or clear if already the only one selected
  // - Ctrl/Cmd+click: add/remove from selection (toggle)
  function handleFilterSelect<K extends 'status' | 'board'>(
    key: K,
    current: string[] | undefined,
    id: string,
    addToSelection: boolean
  ) {
    if (addToSelection) {
      onFiltersChange({ [key]: toggleItem(current, id) })
    } else {
      const isOnlySelected = current?.length === 1 && current[0] === id
      onFiltersChange({ [key]: isOnlySelected ? undefined : [id] })
    }
  }

  const handleStatusSelect = (slug: string, addToSelection: boolean) =>
    handleFilterSelect('status', filters.status, slug, addToSelection)

  const handleBoardSelect = (id: string, addToSelection: boolean) =>
    handleFilterSelect('board', filters.board, id, addToSelection)

  // Tags remain simple toggle (they're already visually distinct as chips)
  const handleTagToggle = (tagId: string) => {
    const newTags = toggleItem(filters.tags, tagId)
    onFiltersChange({ tags: newTags })
  }

  return (
    <div className="space-y-0">
      {/* Status Filter */}
      <FilterSection title="Status">
        <StatusFilterList
          statuses={statuses}
          selectedSlugs={filters.status || []}
          onSelect={handleStatusSelect}
        />
      </FilterSection>

      {/* Board Filter */}
      {boards.length > 0 && (
        <FilterSection title="Board">
          <BoardFilterList
            boards={boards}
            selectedIds={filters.board || []}
            onSelect={handleBoardSelect}
          />
        </FilterSection>
      )}

      {/* Tags Filter */}
      {tags.length > 0 && (
        <FilterSection title="Tags" defaultOpen={true}>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => {
              const isSelected = filters.tags?.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => handleTagToggle(tag.id)}
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
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
