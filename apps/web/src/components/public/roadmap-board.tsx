'use client'

import { useState, useEffect } from 'react'
import { Map } from 'lucide-react'
import { RoadmapColumn } from './roadmap-column'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePublicRoadmaps } from '@/lib/hooks/use-roadmaps-query'
import type { PostStatusEntity, Roadmap } from '@/lib/db'

interface RoadmapBoardProps {
  statuses: PostStatusEntity[]
  initialRoadmaps?: Roadmap[]
  initialSelectedRoadmapId?: string | null
}

export function RoadmapBoard({
  statuses,
  initialRoadmaps,
  initialSelectedRoadmapId,
}: RoadmapBoardProps) {
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(
    initialSelectedRoadmapId ?? null
  )

  const { data: roadmaps } = usePublicRoadmaps({
    enabled: !initialRoadmaps,
  })

  const availableRoadmaps = initialRoadmaps ?? roadmaps ?? []
  const selectedRoadmap = availableRoadmaps.find((r) => r.id === selectedRoadmapId)

  // Auto-select first roadmap when loaded (fallback if not pre-selected)
  useEffect(() => {
    if (availableRoadmaps.length > 0 && selectedRoadmapId === null) {
      setSelectedRoadmapId(availableRoadmaps[0].id)
    }
  }, [availableRoadmaps, selectedRoadmapId])

  // Show empty state if no roadmaps
  if (availableRoadmaps.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <Map className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
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
      {/* Roadmap selector - only show if multiple roadmaps */}
      {availableRoadmaps.length > 1 && (
        <div className="space-y-2">
          <Tabs value={selectedRoadmapId ?? undefined} onValueChange={setSelectedRoadmapId}>
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

      {/* Kanban board */}
      {selectedRoadmapId && (
        <ScrollArea
          className="w-full"
          style={{ height: 'calc(100dvh - 3.5rem - 2rem - 4.5rem - 3rem)' }}
        >
          <div className="flex gap-4 pb-4 h-full">
            {statuses.map((status) => (
              <RoadmapColumn
                key={status.id}
                roadmapId={selectedRoadmapId as `roadmap_${string}`}
                statusId={status.id}
                title={status.name}
                color={status.color}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}
    </div>
  )
}
