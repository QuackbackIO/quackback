import { useEffect } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { MapIcon } from '@heroicons/react/24/solid'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { Card, CardContent } from '@/components/ui/card'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import { usePublicRoadmaps, type RoadmapView } from '@/lib/client/hooks/use-roadmaps-query'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { usePillsScroll } from '@/lib/client/hooks/use-pills-scroll'
import { portalQueries } from '@/lib/client/queries/portal'
import { RoadmapColumn } from './roadmap-column'
import {
  PublicRoadmapFiltersBar,
  PublicRoadmapToolbarFilterButton,
} from './public-roadmap-filters-bar'
import { PublicRoadmapToolbar } from './public-roadmap-toolbar'
import { RoadmapTabs } from './roadmap-tabs'
import { usePublicRoadmapFilters } from './use-public-roadmap-filters'
import { usePublicRoadmapSelection } from './use-public-roadmap-selection'

interface RoadmapBoardProps {
  statuses: PostStatusEntity[]
  initialRoadmaps?: RoadmapView[]
  initialSelectedRoadmapId?: string | null
  isTeamMember?: boolean
}

export function RoadmapBoard({
  statuses,
  initialRoadmaps,
  initialSelectedRoadmapId,
  isTeamMember,
}: RoadmapBoardProps): React.ReactElement {
  const intl = useIntl()
  const { selectedRoadmapId, setSelectedRoadmap } = usePublicRoadmapSelection()
  const { data: roadmaps } = usePublicRoadmaps({ enabled: !initialRoadmaps })
  const columnsScroll = usePillsScroll()

  // Filter state
  const { filters, setFilters, clearFilters, toggleBoard, toggleTag, toggleSegment } =
    usePublicRoadmapFilters()

  // Reference data for filter bar (pre-fetched in route loader)
  const { data: boards } = useSuspenseQuery(portalQueries.boards())
  const { data: tags } = useSuspenseQuery(portalQueries.tags())

  // Segments only available for team members
  const { data: segments } = useSegments({ enabled: !!isTeamMember })

  const availableRoadmaps = initialRoadmaps ?? roadmaps ?? []
  const effectiveSelectedId = selectedRoadmapId ?? initialSelectedRoadmapId
  const selectedRoadmap = availableRoadmaps.find((r) => r.id === effectiveSelectedId)

  useEffect(() => {
    if (availableRoadmaps.length > 0 && !selectedRoadmapId) {
      setSelectedRoadmap(availableRoadmaps[0].id)
    }
  }, [availableRoadmaps, selectedRoadmapId, setSelectedRoadmap])

  if (availableRoadmaps.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 animate-in fade-in duration-200 fill-mode-backwards">
        <div className="text-center">
          <MapIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground">
            {intl.formatMessage({
              id: 'portal.roadmap.empty.title',
              defaultMessage: 'No roadmaps available',
            })}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {intl.formatMessage({
              id: 'portal.roadmap.empty.description',
              defaultMessage: "Check back later to see what we're working on.",
            })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      {availableRoadmaps.length > 1 && (
        <div className="space-y-2">
          <RoadmapTabs
            roadmaps={availableRoadmaps}
            selectedId={effectiveSelectedId}
            onSelect={setSelectedRoadmap}
          />
          {selectedRoadmap?.description && (
            <Card className="bg-muted/50 border-none shadow-none">
              <CardContent className="py-3 px-4">
                <p className="text-sm text-muted-foreground">{selectedRoadmap.description}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <PublicRoadmapToolbar
        currentSort={filters.sort ?? 'votes'}
        onSortChange={(sort) => setFilters({ sort })}
        currentSearch={filters.search}
        onSearchChange={(search) => setFilters({ search })}
        filterButton={
          <PublicRoadmapToolbarFilterButton
            boards={boards}
            tags={tags}
            segments={isTeamMember ? segments : undefined}
            onToggleBoard={toggleBoard}
            onToggleTag={toggleTag}
            onToggleSegment={isTeamMember ? toggleSegment : undefined}
          />
        }
      />

      <PublicRoadmapFiltersBar
        filters={filters}
        onFiltersChange={setFilters}
        onClearAll={clearFilters}
        boards={boards}
        tags={tags}
        segments={isTeamMember ? segments : undefined}
        onToggleBoard={toggleBoard}
        onToggleTag={toggleTag}
        onToggleSegment={isTeamMember ? toggleSegment : undefined}
      />

      {effectiveSelectedId && (
        <div className="relative flex-1 min-h-0">
          <div
            ref={columnsScroll.ref}
            className="flex gap-4 pb-4 h-full overflow-x-auto overflow-y-hidden scrollbar-none snap-x snap-mandatory"
          >
            {statuses.map((status, index) => (
              <div
                key={status.id}
                className="snap-center sm:snap-start flex flex-col animate-in fade-in duration-200 fill-mode-backwards"
                style={{ animationDelay: `${index * 75}ms` }}
              >
                <RoadmapColumn
                  roadmapId={effectiveSelectedId as `roadmap_${string}`}
                  statusId={status.id}
                  title={status.name}
                  color={status.color}
                  filters={filters}
                />
              </div>
            ))}
          </div>

          {columnsScroll.canScrollLeft && (
            <button
              type="button"
              onClick={() => columnsScroll.scrollBy(-320)}
              aria-label={intl.formatMessage({
                id: 'portal.roadmap.columns.scrollLeft',
                defaultMessage: 'Scroll columns left',
              })}
              className="absolute start-0 top-0 bottom-4 flex items-center ps-1 pe-10 bg-gradient-to-r from-background/70 to-transparent z-10"
            >
              <ChevronLeftIcon className="w-5 h-5 text-muted-foreground/70" />
            </button>
          )}
          {columnsScroll.canScrollRight && (
            <button
              type="button"
              onClick={() => columnsScroll.scrollBy(320)}
              aria-label={intl.formatMessage({
                id: 'portal.roadmap.columns.scrollRight',
                defaultMessage: 'Scroll columns right',
              })}
              className="absolute end-0 top-0 bottom-4 flex items-center pe-1 ps-10 bg-gradient-to-l from-background/70 to-transparent z-10"
            >
              <ChevronRightIcon className="w-5 h-5 text-muted-foreground/70" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
