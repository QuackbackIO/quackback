import { RoadmapColumn } from './roadmap-column'
import type { PostStatus, PostStatusEntity } from '@quackback/db'

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
  statuses: PostStatusEntity[]
}

export function RoadmapBoard({ posts, statuses }: RoadmapBoardProps) {
  // Group posts by status slug
  const postsByStatus = statuses.reduce(
    (acc, status) => {
      acc[status.slug] = posts.filter((post) => post.status === status.slug)
      return acc
    },
    {} as Record<string, RoadmapPost[]>
  )

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {statuses.map((status) => (
        <RoadmapColumn
          key={status.id}
          title={status.name}
          posts={postsByStatus[status.slug] || []}
          color={status.color}
        />
      ))}
    </div>
  )
}
