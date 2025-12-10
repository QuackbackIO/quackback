import { RoadmapColumn } from './roadmap-column'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import type { PostStatusEntity } from '@quackback/db/types'
import type { RoadmapPostListResult } from '@quackback/domain'

interface StatusInitialData {
  statusSlug: string
  data: RoadmapPostListResult
}

interface RoadmapBoardProps {
  organizationId: string
  statuses: PostStatusEntity[]
  initialDataByStatus: StatusInitialData[]
}

export function RoadmapBoard({ organizationId, statuses, initialDataByStatus }: RoadmapBoardProps) {
  // Create lookup map for initial data
  const dataByStatus = Object.fromEntries(initialDataByStatus.map((d) => [d.statusSlug, d.data]))

  return (
    <ScrollArea
      className="w-full"
      style={{ height: 'calc(100dvh - 3.5rem - 2rem - 4.5rem - 1rem)' }}
    >
      <div className="flex gap-4 pb-4 h-full">
        {statuses.map((status) => (
          <RoadmapColumn
            key={status.id}
            organizationId={organizationId}
            statusSlug={status.slug}
            title={status.name}
            color={status.color}
            initialData={dataByStatus[status.slug]}
          />
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
}
