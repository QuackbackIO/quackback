import { RoadmapColumn } from './roadmap-column'
import type { PostStatus } from '@quackback/db'

interface RoadmapPost {
  id: string
  title: string
  status: PostStatus
  voteCount: number
  board: {
    id: string
    name: string
    slug: string
  }
}

interface RoadmapBoardProps {
  posts: RoadmapPost[]
  statuses?: PostStatus[]
}

const STATUS_CONFIG: Record<
  PostStatus,
  { label: string; color: string }
> = {
  open: { label: 'Open', color: 'bg-blue-500' },
  under_review: { label: 'Under Review', color: 'bg-yellow-500' },
  planned: { label: 'Planned', color: 'bg-purple-500' },
  in_progress: { label: 'In Progress', color: 'bg-orange-500' },
  complete: { label: 'Complete', color: 'bg-green-500' },
  closed: { label: 'Closed', color: 'bg-gray-500' },
}

const DEFAULT_STATUSES: PostStatus[] = ['planned', 'in_progress', 'complete']

export function RoadmapBoard({ posts, statuses = DEFAULT_STATUSES }: RoadmapBoardProps) {
  // Group posts by status
  const postsByStatus = statuses.reduce(
    (acc, status) => {
      acc[status] = posts.filter((post) => post.status === status)
      return acc
    },
    {} as Record<PostStatus, RoadmapPost[]>
  )

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {statuses.map((status) => (
        <RoadmapColumn
          key={status}
          title={STATUS_CONFIG[status].label}
          status={status}
          posts={postsByStatus[status] || []}
          color={STATUS_CONFIG[status].color}
        />
      ))}
    </div>
  )
}
