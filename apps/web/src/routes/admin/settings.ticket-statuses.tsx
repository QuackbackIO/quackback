import { createFileRoute, redirect } from '@tanstack/react-router'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { useState } from 'react'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { NewButton } from '@/components/shared/new-button'
import { TicketStatusList } from '@/components/admin/settings/tickets/ticket-status-list'
import { StageLabelsCard } from '@/components/admin/settings/tickets/stage-labels-card'
import {
  ticketStatusesQuery,
  ticketStageLabelsQuery,
} from '@/components/admin/settings/tickets/queries'
import { adminPageHead } from '@/lib/client/admin-head'
import { seedAdminAreas } from '@/lib/shared/i18n'

export const Route = createFileRoute('/admin/settings/ticket-statuses')({
  head: adminPageHead('Ticket statuses settings'),
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportTickets) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/ticket-statuses')
    await Promise.all([
      context.queryClient.ensureQueryData(ticketStatusesQuery),
      context.queryClient.ensureQueryData(ticketStageLabelsQuery),
    ])
    return seedAdminAreas(context.personLocale, 'adminChannelSettings')
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
