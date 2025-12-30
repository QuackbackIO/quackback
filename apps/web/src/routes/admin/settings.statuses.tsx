import { createFileRoute } from '@tanstack/react-router'
import { requireWorkspace } from '@/lib/workspace'
import { Settings } from 'lucide-react'
import { StatusList } from '@/app/admin/settings/statuses/status-list'
import { listPublicStatuses } from '@/lib/statuses'

export const Route = createFileRoute('/admin/settings/statuses')({
  loader: async () => {
    // Settings is validated in root layout
    await requireWorkspace()

    // Services now return TypeIDs directly
    const statusesResult = await listPublicStatuses()
    const statuses = statusesResult.success ? statusesResult.value : []

    return { statuses }
  },
  component: StatusesPage,
})

function StatusesPage() {
  const { statuses } = Route.useLoaderData()

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Public Statuses</h1>
          <p className="text-sm text-muted-foreground">
            Customize the statuses available for feedback posts
          </p>
        </div>
      </div>

      <StatusList initialStatuses={statuses} />
    </div>
  )
}
