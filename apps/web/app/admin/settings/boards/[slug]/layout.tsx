import { notFound } from 'next/navigation'
import { requireAuthenticatedTenant } from '@/lib/tenant'
import { db, boards, eq } from '@/lib/db'
import { BoardSettingsHeader } from './board-settings-header'
import { BoardSettingsNav } from './board-settings-nav'

export default async function BoardSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  await requireAuthenticatedTenant()

  // Get current board and all boards for the switcher
  const [board, allBoards] = await Promise.all([
    db.query.boards.findFirst({
      where: eq(boards.slug, slug),
    }),
    db.query.boards.findMany({
      orderBy: (boards, { asc }) => [asc(boards.name)],
    }),
  ])

  if (!board) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <BoardSettingsHeader currentBoard={board} allBoards={allBoards} />
      <div className="flex gap-8">
        <BoardSettingsNav boardSlug={slug} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
