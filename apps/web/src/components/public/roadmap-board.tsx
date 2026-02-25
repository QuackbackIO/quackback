import { useEffect } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { MapIcon } from '@heroicons/react/24/solid'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import { usePublicRoadmaps, type RoadmapView } from '@/lib/client/hooks/use-roadmaps-query'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { portalQueries } from '@/lib/client/queries/portal'
import { RoadmapColumn } from './roadmap-column'
import { RoadmapFiltersBar } from '@/components/admin/roadmap/roadmap-filters-bar'
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
  const { selectedRoadmapId, setSelectedRoadmap } = usePublicRoadmapSelection()
  const { data: roadmaps } = usePublicRoadmaps({ enabled: !initialRoadmaps })

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
          <h3 className="text-lg font-medium text-foreground">No roadmaps available</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Check back later to see what we're working on.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {availableRoadmaps.length > 1 && (
        <div className="space-y-2">
          <Tabs value={effectiveSelectedId ?? undefined} onValueChange={setSelectedRoadmap}>
            <TabsList>
              {availableRoadmaps.map((roadmap) => (
                <TabsTrigger key={roadmap.id} value={roadmap.id}>
                  {roadmap.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {selectedRoadmap?.description && (
            <Card className="bg-muted/50 border-none shadow-none">
              <CardContent className="py-3 px-4">
                <p className="text-sm text-muted-foreground">{selectedRoadmap.description}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <RoadmapFiltersBar
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
        <ScrollArea
          className="w-full"
          style={{ height: 'calc(100dvh - 3.5rem - 2rem - 4.5rem - 3rem)' }}
        >
          <div className="flex gap-4 pb-4 h-full">
            {statuses.map((status, index) => (
              <div
                key={status.id}
                className="animate-in fade-in duration-200 fill-mode-backwards"
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
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}
    </div>
  )
}
