import { notFound } from 'next/navigation'
import { requireAuthenticatedTenantBySlug } from '@/lib/tenant'
import { db, boards, eq, and } from '@/lib/db'
import { BoardSettingsHeader } from './board-settings-header'
import { BoardSettingsNav } from './board-settings-nav'

export default async function BoardSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string; slug: string }>
}) {
  const { orgSlug, slug } = await params
  const { organization } = await requireAuthenticatedTenantBySlug(orgSlug)

  // Get current board and all boards for the switcher
  const [board, allBoards] = await Promise.all([
    db.query.boards.findFirst({
      where: and(eq(boards.organizationId, organization.id), eq(boards.slug, slug)),
    }),
    db.query.boards.findMany({
      where: eq(boards.organizationId, organization.id),
      orderBy: (boards, { asc }) => [asc(boards.name)],
    }),
  ])

  if (!board) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <BoardSettingsHeader
        currentBoard={board}
        allBoards={allBoards}
        organizationId={organization.id}
      />
      <div className="flex gap-8">
        <BoardSettingsNav boardSlug={slug} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
