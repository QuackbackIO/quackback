import { notFound } from 'next/navigation'
import { requireAuthenticatedTenant } from '@/lib/tenant'
import { db, boards, eq } from '@/lib/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BoardGeneralForm } from './board-general-form'
import { DeleteBoardForm } from './delete-board-form'

export default async function BoardGeneralSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  await requireAuthenticatedTenant()

  // Database now returns TypeIDs directly
  const board = await db.query.boards.findFirst({
    where: eq(boards.slug, slug),
  })

  if (!board) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>Update your board details</CardDescription>
        </CardHeader>
        <CardContent>
          <BoardGeneralForm board={board} />
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Irreversible actions that will permanently affect your board
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteBoardForm board={board} />
        </CardContent>
      </Card>
    </div>
  )
}
