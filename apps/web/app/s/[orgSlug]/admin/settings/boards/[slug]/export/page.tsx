import { notFound } from 'next/navigation'
import { requireAuthenticatedTenantBySlug } from '@/lib/tenant'
import { db, boards, eq, and } from '@quackback/db'
import { BoardExportSection } from './board-export-section'

export default async function BoardExportPage({
  params,
}: {
  params: Promise<{ orgSlug: string; slug: string }>
}) {
  const { orgSlug, slug } = await params
  const { organization } = await requireAuthenticatedTenantBySlug(orgSlug)

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.organizationId, organization.id), eq(boards.slug, slug)),
  })

  if (!board) {
    notFound()
  }

  // board.id is already a TypeID from Drizzle schema
  const boardId = board.id

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Export Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Download posts from {board.name} as a CSV file
        </p>
      </div>
      <BoardExportSection organizationId={organization.id} boardId={boardId} />
    </div>
  )
}
