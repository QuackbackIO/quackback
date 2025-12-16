import { notFound } from 'next/navigation'
import { requireAuthenticatedTenantBySlug } from '@/lib/tenant'
import { db, boards, eq, and } from '@/lib/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BoardAccessForm } from './board-access-form'

export default async function BoardAccessSettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; slug: string }>
}) {
  const { orgSlug, slug } = await params
  const { organization } = await requireAuthenticatedTenantBySlug(orgSlug)

  // Database now returns TypeIDs directly
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
          <CardTitle>Access Settings</CardTitle>
          <CardDescription>Control who can view this board on your portal</CardDescription>
        </CardHeader>
        <CardContent>
          <BoardAccessForm board={board} organizationId={organization.id} />
        </CardContent>
      </Card>
    </div>
  )
}
