import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { useState } from 'react'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { NewButton } from '@/components/shared/new-button'
import { TicketTypesManager } from '@/components/admin/settings/tickets/ticket-types-manager'
import { ticketTypesQuery } from '@/components/admin/settings/tickets/queries'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/ticket-types')({
  head: adminPageHead('Ticket types settings'),
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
  const [creating, setCreating] = useState(false)
  return (
    <SettingsPage
      page="/admin/settings/ticket-types"
      description="The fields a ticket captures."
      actions={<NewButton noun="type" onClick={() => setCreating(true)} />}
    >
      <TicketTypesManager creating={creating} onCreatingChange={setCreating} />
    </SettingsPage>
  )
}
