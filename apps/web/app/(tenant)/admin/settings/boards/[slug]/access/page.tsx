import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/tenant'
import { db, boards, eq, and } from '@quackback/db'
import type { PermissionLevel } from '@quackback/db/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BoardAccessForm } from './board-access-form'

export default async function BoardAccessSettingsPage({
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

  // Get org defaults for the form to display
  const orgDefaults = {
    voting: organization.portalVoting as PermissionLevel,
    commenting: organization.portalCommenting as PermissionLevel,
    submissions: organization.portalSubmissions as PermissionLevel,
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Access Settings</CardTitle>
          <CardDescription>
            Control who can view this board and interact with feedback
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BoardAccessForm
            board={board}
            organizationId={organization.id}
            orgDefaults={orgDefaults}
          />
        </CardContent>
      </Card>
    </div>
  )
}
