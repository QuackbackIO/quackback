import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { useState } from 'react'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { NewButton } from '@/components/shared/new-button'
import { TicketStatusList } from '@/components/admin/settings/tickets/ticket-status-list'
import { StageLabelsCard } from '@/components/admin/settings/tickets/stage-labels-card'
import {
  ticketStatusesQuery,
  ticketStageLabelsQuery,
} from '@/components/admin/settings/tickets/queries'

export const Route = createFileRoute('/admin/settings/ticket-statuses')({
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportTickets) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.TICKET_MANAGE_TYPES)
    await Promise.all([
      context.queryClient.ensureQueryData(ticketStatusesQuery),
      context.queryClient.ensureQueryData(ticketStageLabelsQuery),
    ])
    return {}
  },
  component: TicketStatusesPage,
})

function TicketStatusesPage() {
  const [creating, setCreating] = useState(false)
  return (
    <SettingsPage
      page="/admin/settings/ticket-statuses"
      actions={<NewButton noun="status" onClick={() => setCreating(true)} />}
    >
      <TicketStatusList creating={creating} onCreatingChange={setCreating} />
      <StageLabelsCard />
    </SettingsPage>
  )
}
