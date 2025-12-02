import { redirect } from 'next/navigation'
import { requireTenant } from '@/lib/tenant'
import { db, boards, eq } from '@quackback/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MessageSquare } from 'lucide-react'
import { CreateBoardDialog } from './create-board-dialog'

export default async function BoardsSettingsPage() {
  const { organization } = await requireTenant()

  // Only fetch slug for faster redirect
  const firstBoard = await db.query.boards.findFirst({
    where: eq(boards.organizationId, organization.id),
    orderBy: (boards, { desc }) => [desc(boards.updatedAt)],
    columns: { slug: true },
  })

  // If boards exist, redirect to the most recently updated one
  if (firstBoard) {
    redirect(`/admin/settings/boards/${firstBoard.slug}`)
  }

  // No boards - show create prompt
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-foreground">Board Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your feedback board settings and preferences
        </p>
      </div>

      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="mt-4">No boards yet</CardTitle>
          <CardDescription>
            Create your first feedback board to start collecting ideas from your users
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <CreateBoardDialog organizationId={organization.id} />
        </CardContent>
      </Card>
    </div>
  )
}
