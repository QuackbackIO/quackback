import { RoadmapCard } from './roadmap-card'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { PostStatus } from '@quackback/db'

interface RoadmapPost {
  id: string
  title: string
  voteCount: number
  board: {
    slug: string
    name: string
  }
}

interface RoadmapColumnProps {
  title: string
  status: PostStatus
  posts: RoadmapPost[]
  color: string
}

export function RoadmapColumn({ title, posts, color }: RoadmapColumnProps) {
  return (
    <Card className="flex-1 min-w-[300px] flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full ${color}`} />
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
          </div>
          <Badge variant="secondary" className="text-xs">
            {posts.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-[300px]">
        {posts.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No items yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {posts.map((post) => (
              <RoadmapCard key={post.id} {...post} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
