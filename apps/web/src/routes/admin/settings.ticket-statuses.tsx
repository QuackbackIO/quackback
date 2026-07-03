import { createFileRoute, Navigate } from '@tanstack/react-router'
import { QueueListIcon } from '@heroicons/react/24/solid'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { TicketStatusList } from '@/components/admin/settings/tickets/ticket-status-list'
import { StageLabelsCard } from '@/components/admin/settings/tickets/stage-labels-card'
import {
  ticketStatusesQuery,
  ticketStageLabelsQuery,
} from '@/components/admin/settings/tickets/queries'

export const Route = createFileRoute('/admin/settings/ticket-statuses')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    await Promise.all([
      context.queryClient.ensureQueryData(ticketStatusesQuery),
      context.queryClient.ensureQueryData(ticketStageLabelsQuery),
    ])
    return {}
  },
  component: TicketStatusesRoute,
})

/** Gate behind the experimental `supportTickets` flag (off by default). */
function TicketStatusesRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportTickets) {
    return <Navigate to="/admin/settings" />
  }
  return <TicketStatusesPage />
}

function TicketStatusesPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={QueueListIcon}
        title="Ticket statuses"
        description="Define the statuses tickets move through and the stages your customers see."
      />
      <TicketStatusList />
      <StageLabelsCard />
    </div>
  )
}
