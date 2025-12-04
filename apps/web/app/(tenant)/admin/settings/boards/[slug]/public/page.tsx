import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/tenant'
import { db, boards, eq, and } from '@quackback/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BoardPublicForm } from './board-public-form'

export default async function BoardPublicSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { organization } = await requireTenant()
  const { slug } = await params

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.organizationId, organization.id), eq(boards.slug, slug)),
  })

  if (!board) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Public Portal Settings</CardTitle>
          <CardDescription>Configure how this board appears on the public portal</CardDescription>
        </CardHeader>
        <CardContent>
          <BoardPublicForm board={board} organizationId={organization.id} />
        </CardContent>
      </Card>
    </div>
  )
}
