import { getCurrentOrganization } from '@/lib/tenant'
import { getPublicBoardsWithStats } from '@quackback/db/queries/public'
import { BoardCard } from '@/components/public/board-card'

/**
 * Public boards listing page
 */
export default async function BoardsPage() {
  const org = await getCurrentOrganization()

  if (!org) {
    return null
  }

  const boards = await getPublicBoardsWithStats(org.id)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-6">Boards</h1>

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
    </div>
  )
}
