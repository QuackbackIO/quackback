import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { TicketIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { TicketTypesManager } from '@/components/admin/settings/tickets/ticket-types-manager'
import { ticketTypesQuery } from '@/components/admin/settings/tickets/queries'

export const Route = createFileRoute('/admin/settings/ticket-types')({
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportTickets) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.TICKET_MANAGE_TYPES)
    await context.queryClient.ensureQueryData(ticketTypesQuery)
    return {}
  },
  component: TicketTypesPage,
})

function TicketTypesPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={TicketIcon}
        title="Ticket types"
        description="Types define the fields a ticket captures. Each type belongs to a category — customer, back-office or tracker — which drives its behavior."
      />
      <TicketTypesManager />
    </div>
  )
}
