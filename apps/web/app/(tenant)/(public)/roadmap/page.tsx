import { getCurrentOrganization } from '@/lib/tenant'
import { getRoadmapPosts } from '@quackback/db/queries/public'
import { RoadmapBoard } from '@/components/public/roadmap-board'
import type { PostStatus } from '@quackback/db'

// All roadmap-visible statuses for the full roadmap view
const ROADMAP_STATUSES: PostStatus[] = ['planned', 'in_progress', 'complete']

/**
 * Full roadmap page with kanban board
 */
export default async function RoadmapPage() {
  const org = await getCurrentOrganization()

  if (!org) {
    return null
  }

  const roadmapPosts = await getRoadmapPosts(org.id, ROADMAP_STATUSES)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Roadmap</h1>
        <p className="text-muted-foreground">
          See what we're working on and what's coming next.
        </p>
      </div>

      <RoadmapBoard posts={roadmapPosts} statuses={ROADMAP_STATUSES} />
    </div>
  )
}
