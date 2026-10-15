import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { SettingsSection } from '@/components/admin/settings/settings-section'
import { NewButton } from '@/components/shared/new-button'
import { StageLabelsCard } from '@/components/admin/settings/tickets/stage-labels-card'
import { TicketStatusList } from '@/components/admin/settings/tickets/ticket-status-list'
import { TicketTypesManager } from '@/components/admin/settings/tickets/ticket-types-manager'
import {
  ticketStageLabelsQuery,
  ticketStatusesQuery,
  ticketTypesQuery,
} from '@/components/admin/settings/tickets/queries'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/tickets')({
  head: adminPageHead('Tickets settings'),
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportTickets) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.TICKET_MANAGE_TYPES)
    await Promise.all([
      context.queryClient.ensureQueryData(ticketTypesQuery),
      context.queryClient.ensureQueryData(ticketStatusesQuery),
      context.queryClient.ensureQueryData(ticketStageLabelsQuery),
    ])
    return {}
  },
  component: TicketsPage,
})

function TicketsPage() {
  const intl = useIntl()
  const [creatingType, setCreatingType] = useState(false)
  const [creatingStatus, setCreatingStatus] = useState(false)
  return (
    <SettingsPage page="/admin/settings/tickets">
      <SettingsSection
        title={intl.formatMessage({ id: 'settings.tickets.types', defaultMessage: 'Ticket types' })}
        action={<NewButton noun="type" onClick={() => setCreatingType(true)} />}
      >
        <TicketTypesManager creating={creatingType} onCreatingChange={setCreatingType} />
      </SettingsSection>
      <SettingsSection
        title={intl.formatMessage({
          id: 'settings.tickets.statuses',
          defaultMessage: 'Ticket statuses',
        })}
        action={<NewButton noun="status" onClick={() => setCreatingStatus(true)} />}
      >
        <div className="space-y-6">
          <TicketStatusList creating={creatingStatus} onCreatingChange={setCreatingStatus} />
          <StageLabelsCard />
        </div>
      </SettingsSection>
    </SettingsPage>
  )
}
