import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  CheckIcon,
  ClockIcon,
  ShieldCheckIcon,
  TagIcon,
  TrashIcon,
} from '@heroicons/react/16/solid'
import { adminQueries } from '@/lib/client/queries/admin'
import { FilterList, StatusFilterList, BoardFilterList } from './single-select-filter-list'
import { toggleItem } from '@/components/shared/filter-utils'
import { FilterSection } from '@/components/shared/filter-section'
import { MENU_ICON, MENU_ROW } from '@/components/ui/menu'
import { cn } from '@/lib/shared/utils'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
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
  /** The moderation queue page is showing rather than the post list */
  moderationActive?: boolean
}

function countFor(counts: Record<string, number> | undefined, id: string): number | undefined {
  if (!counts) return undefined
  return counts[id] ?? 0
}

/**
 * Memoized: the panel shows the filters and their counts, so the list's own
 * updates (a page loading, the results of a search arriving) render it only
 * when the filters or the reference data it lists change.
 */
export const InboxFiltersPanel = memo(function InboxFiltersPanel({
  filters,
  onFiltersChange,
  boards,
  tags,
  statuses,
  segments,
  moderationActive,
}: InboxFiltersProps) {
  const { data: facetCounts } = useInboxFacetCounts(filters)
  // The queue and its count are read with post.approve.
  const canModerate = usePermission(PERMISSIONS.POST_APPROVE)

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

  // Tags toggle on click; Ctrl/Cmd is not needed to combine them
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
      {canModerate && (
        <FilterSection title="Review">
          <ModerationRow active={moderationActive} />
        </FilterSection>
      )}

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
        <FilterSection title="Tags">
          <FilterList
            items={tags.map((tag) => ({ id: tag.id, name: tag.name, icon: TagIcon }))}
            selectedIds={filters.tags ?? []}
            onSelect={handleTagToggle}
            counts={facetCounts?.tags}
          />
        </FilterSection>
      )}

      {/* Segments Filter */}
      {segments && segments.length > 0 && (
        <FilterSection title="Segments">
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
            { id: 'responded', name: 'Responded', icon: CheckIcon },
            { id: 'unresponded', name: 'Unresponded', icon: ClockIcon },
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
          items={[{ id: 'deleted', name: 'Deleted posts', icon: TrashIcon }]}
          selectedIds={filters.showDeleted ? ['deleted'] : []}
          onSelect={() => {
            onFiltersChange({ showDeleted: !filters.showDeleted || undefined })
          }}
          counts={deletedCounts}
        />
      </FilterSection>
    </div>
  )
})

/** Opens the moderation queue, with the number of items waiting. */
function ModerationRow({ active }: { active?: boolean }) {
  const { data } = useQuery(adminQueries.moderationStatus())
  return (
    <Link
      to="/admin/feedback/moderation"
      data-active={active || undefined}
      className={cn(
        MENU_ROW,
        'w-full',
        active
          ? 'bg-muted text-foreground font-medium'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      )}
    >
      <ShieldCheckIcon className={MENU_ICON} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">Moderation</span>
      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {data?.pendingCount ?? 0}
      </span>
    </Link>
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
