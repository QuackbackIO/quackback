import { notFound } from 'next/navigation'
import { requireAuthenticatedTenant } from '@/lib/tenant'
import { db, boards, eq } from '@/lib/db'
import { BoardImportSection } from './board-import-section'

export default async function BoardImportPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { settings } = await requireAuthenticatedTenant()

  const board = await db.query.boards.findFirst({
    where: eq(boards.slug, slug),
  })

  if (!board) {
    notFound()
  }

  // board.id is already a TypeID from Drizzle schema
  const boardId = board.id

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Import Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a CSV file to import posts into {board.name}
        </p>
      </div>
      <BoardImportSection workspaceId={settings.id} boardId={boardId} />
    </div>
  )
}
