import { getCurrentOrganization } from '@/lib/tenant'
import { getPublicBoardsWithStats, getRoadmapPosts } from '@quackback/db/queries/public'
import { BoardCard } from '@/components/public/board-card'
import { RoadmapBoard } from '@/components/public/roadmap-board'
import type { PostStatus } from '@quackback/db'
import Link from 'next/link'

// Default roadmap statuses for the home page preview
const DEFAULT_ROADMAP_STATUSES: PostStatus[] = ['planned', 'in_progress', 'complete']

/**
 * Public portal home page
 * Displays public boards and roadmap preview
 */
export default async function PortalHomePage() {
  const org = await getCurrentOrganization()

  if (!org) {
    return null
  }

  // Fetch public boards and roadmap data in parallel
  const [boards, roadmapPosts] = await Promise.all([
    getPublicBoardsWithStats(org.id),
    getRoadmapPosts(org.id, DEFAULT_ROADMAP_STATUSES),
  ])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Boards Section */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Boards</h2>
          <Link
            href="/boards"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            View all →
          </Link>
        </div>

        {boards.length === 0 ? (
          <p className="text-muted-foreground">No public boards available.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => (
              <BoardCard
                key={board.id}
                slug={board.slug}
                name={board.name}
                description={board.description}
                postCount={board.postCount}
              />
            ))}
          </div>
        )}
      </section>

      {/* Roadmap Section */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Roadmap</h2>
          <Link
            href="/roadmap"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            View full roadmap →
          </Link>
        </div>

        <RoadmapBoard posts={roadmapPosts} />
      </section>
    </div>
  )
}
