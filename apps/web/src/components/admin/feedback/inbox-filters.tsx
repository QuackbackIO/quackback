import { FilterList, StatusFilterList, BoardFilterList } from './single-select-filter-list'
import { toggleItem } from './filter-utils'
import { FilterSection } from '@/components/shared/filter-section'
import type { InboxFilters } from '@/components/admin/feedback/use-inbox-filters'
import type { Board, Tag, PostStatusEntity } from '@/lib/shared/db-types'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'

interface InboxFiltersProps {
  filters: InboxFilters
  onFiltersChange: (updates: Partial<InboxFilters>) => void
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  segments?: SegmentListItem[]
}

export function InboxFiltersPanel({
  filters,
  onFiltersChange,
  boards,
  tags,
  statuses,
  segments,
}: InboxFiltersProps) {
  // Handle filter selection with multi-select support
  // - Regular click: select only this item (replace), or clear if already the only one selected
  // - Ctrl/Cmd+click: add/remove from selection (toggle)
  function handleFilterSelect<K extends 'status' | 'board' | 'segmentIds'>(
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

  const handleSegmentSelect = (id: string, addToSelection: boolean) =>
    handleFilterSelect('segmentIds', filters.segmentIds, id, addToSelection)

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

      {/* Segments Filter */}
      {segments && segments.length > 0 && (
        <FilterSection title="Segments" defaultOpen={false}>
          <div className="space-y-0.5">
            {segments.map((segment) => {
              const isSelected = filters.segmentIds?.includes(segment.id)
              return (
                <button
                  key={segment.id}
                  type="button"
                  onClick={(e) => handleSegmentSelect(segment.id, e.ctrlKey || e.metaKey)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                    isSelected
                      ? 'bg-foreground/10 text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: segment.color }}
                  />
                  <span className="truncate">{segment.name}</span>
                  {segment.memberCount != null && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {segment.memberCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </FilterSection>
      )}

      {/* Team Response Filter */}
      <FilterSection title="Team response">
        <FilterList
          items={[
            { id: 'responded', name: 'Responded' },
            { id: 'unresponded', name: 'Unresponded' },
          ]}
          selectedIds={filters.responded && filters.responded !== 'all' ? [filters.responded] : []}
          onSelect={(id) => {
            const isAlreadySelected = filters.responded === id
            onFiltersChange({
              responded: isAlreadySelected ? undefined : (id as 'responded' | 'unresponded'),
            })
          }}
        />
      </FilterSection>

      {/* Other Filters */}
      <FilterSection title="Other">
        <FilterList
          items={[{ id: 'deleted', name: 'Deleted posts' }]}
          selectedIds={filters.showDeleted ? ['deleted'] : []}
          onSelect={() => {
            onFiltersChange({ showDeleted: !filters.showDeleted || undefined })
          }}
        />
      </FilterSection>
    </div>
  )
}
