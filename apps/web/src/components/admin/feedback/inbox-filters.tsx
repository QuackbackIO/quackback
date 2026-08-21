import { FilterList, StatusFilterList, BoardFilterList } from './single-select-filter-list'
import { toggleItem } from '@/components/shared/filter-utils'
import { FilterSection } from '@/components/shared/filter-section'
import { MENU_ROW } from '@/components/ui/menu'
import { cn } from '@/lib/shared/utils'
import { useInboxFacetCounts } from '@/lib/client/hooks/use-inbox-query'
import type { InboxFilters } from '@/components/admin/feedback/use-inbox-filters'
import type { InboxFilterCounts } from '@/lib/shared/types'
import type { Board, PostTag, PostStatusEntity } from '@/lib/shared/db-types'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'

interface InboxFiltersProps {
  filters: InboxFilters
  onFiltersChange: (updates: Partial<InboxFilters>) => void
  boards: Board[]
  tags: PostTag[]
  statuses: PostStatusEntity[]
  segments?: SegmentListItem[]
}

function countFor(counts: Record<string, number> | undefined, id: string): number | undefined {
  if (!counts) return undefined
  return counts[id] ?? 0
}

export function InboxFiltersPanel({
  filters,
  onFiltersChange,
  boards,
  tags,
  statuses,
  segments,
}: InboxFiltersProps) {
  const { data: facetCounts } = useInboxFacetCounts(filters)

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

  const respondedCounts = respondedCountMap(facetCounts)
  const deletedCounts = deletedCountMap(facetCounts)

  return (
    <div className="space-y-0">
      {/* Status Filter */}
      <FilterSection title="Status">
        <StatusFilterList
          statuses={statuses}
          selectedSlugs={filters.status || []}
          onSelect={handleStatusSelect}
          counts={facetCounts?.statuses}
        />
      </FilterSection>

      {/* Board Filter */}
      {boards.length > 0 && (
        <FilterSection title="Board">
          <BoardFilterList
            boards={boards}
            selectedIds={filters.board || []}
            onSelect={handleBoardSelect}
            counts={facetCounts?.boards}
          />
        </FilterSection>
      )}

      {/* Tags Filter */}
      {tags.length > 0 && (
        <FilterSection title="Tags" defaultOpen={true}>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const isSelected = filters.tags?.includes(tag.id)
              const count = countFor(facetCounts?.tags, tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => handleTagToggle(tag.id)}
                  aria-label={count == null ? tag.name : `${tag.name}, ${count}`}
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {tag.name}
                  {count != null && (
                    <span className="ml-1 text-[11px] tabular-nums opacity-70">{count}</span>
                  )}
                </button>
              )
            })}
          </div>
        </FilterSection>
      )}

      {/* Segments Filter */}
      {segments && segments.length > 0 && (
        <FilterSection title="Segments" defaultOpen={true}>
          <div className="space-y-1">
            {segments.map((segment) => {
              const isSelected = filters.segmentIds?.includes(segment.id)
              const count = countFor(facetCounts?.segments, segment.id)
              return (
                <button
                  key={segment.id}
                  type="button"
                  onClick={(e) => handleSegmentSelect(segment.id, e.ctrlKey || e.metaKey)}
                  aria-label={count == null ? segment.name : `${segment.name}, ${count}`}
                  className={cn(
                    MENU_ROW,
                    'w-full',
                    isSelected
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: segment.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-left">{segment.name}</span>
                  {count != null && (
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {count}
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
          counts={respondedCounts}
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
          counts={deletedCounts}
        />
      </FilterSection>
    </div>
  )
}

function respondedCountMap(
  counts: InboxFilterCounts | undefined
): Record<string, number> | undefined {
  if (!counts) return undefined
  return {
    responded: counts.responded.responded,
    unresponded: counts.responded.unresponded,
  }
}

function deletedCountMap(
  counts: InboxFilterCounts | undefined
): Record<string, number> | undefined {
  if (!counts) return undefined
  return { deleted: counts.deleted }
}
