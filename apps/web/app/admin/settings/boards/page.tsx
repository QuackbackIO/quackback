import { redirect } from 'next/navigation'
import { requireAuthenticatedTenant } from '@/lib/tenant'
import { db } from '@/lib/db'
import { Layout, MessageSquare } from 'lucide-react'
import { CreateBoardDialog } from './create-board-dialog'

export default async function BoardsSettingsPage() {
  // Settings is validated in root layout
  await requireAuthenticatedTenant()

  // Only fetch slug for faster redirect
  const firstBoard = await db.query.boards.findFirst({
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
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Layout className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Board Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure your feedback board settings and preferences
          </p>
        </div>
      </div>

      {/* Empty State */}
      <div className="rounded-xl border border-border/50 bg-card p-8 shadow-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
          <MessageSquare className="h-6 w-6 text-primary" />
        </div>
        <h2 className="font-semibold text-lg mb-1">No boards yet</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Create your first feedback board to start collecting ideas from your users
        </p>
        <CreateBoardDialog />
      </div>
    </div>
  )
}
