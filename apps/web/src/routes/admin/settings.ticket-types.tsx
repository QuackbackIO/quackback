import { createFileRoute, Navigate } from '@tanstack/react-router'
import { TicketIcon } from '@heroicons/react/24/solid'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { TicketTypesManager } from '@/components/admin/settings/tickets/ticket-types-manager'
import { ticketFormsQuery } from '@/components/admin/settings/tickets/queries'

export const Route = createFileRoute('/admin/settings/ticket-types')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    await context.queryClient.ensureQueryData(ticketFormsQuery)
    return {}
  },
  component: TicketTypesRoute,
})

/** Gate behind the experimental `supportTickets` flag (off by default). */
function TicketTypesRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportTickets) {
    return <Navigate to="/admin/settings" />
  }
  return <TicketTypesPage />
}

function TicketTypesPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={TicketIcon}
        title="Ticket types"
        description="Customer, back-office and tracker tickets each have their own intake form."
      />
      <TicketTypesManager />
    </div>
  )
}
