import { useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AdditionalInstructionsCard } from '@/components/admin/automation/additional-instructions-card'
import {
  AgentPauseControl,
  useAgentStatusLine,
} from '@/components/admin/automation/assistant-deployment-card'
import { AssistantIdentityCard } from '@/components/admin/automation/assistant-identity-card'
import { AssistantPageShell } from '@/components/admin/automation/assistant-page-shell'
import { AssistantVoiceCard } from '@/components/admin/automation/assistant-basics-card'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import type { FeatureFlags } from '@/lib/shared/types'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/ai/customers')({
  head: adminPageHead('Quackback AI settings: Customers'),
  beforeLoad: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.AI_CUSTOMER_MANAGE)
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(assistantQueries.settings()),
      context.queryClient.ensureQueryData(settingsQueries.widgetConfig()),
    ])
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: CustomersPage,
})

function CustomersPage() {
  const intl = useIntl()
  const settings = useWorkspaceSettings()
  const widget = useQuery(settingsQueries.widgetConfig())
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const deployment =
    widget.data?.messenger?.assistant ?? settings?.publicWidgetConfig?.messenger?.assistant
  // Quackback AI answers in Messenger, which needs the Support inbox; tickets alone do not give it one.
  const statusLine = useAgentStatusLine(
    { enabled: deployment?.enabled ?? true, respond: deployment?.respond ?? true },
    Boolean(flags?.supportInbox),
    Boolean(flags?.supportTickets)
  )
  return (
    <AssistantPageShell
      page="/admin/settings/ai/customers"
      description={statusLine}
      actions={
        flags?.supportInbox ? (
          <Link to="/admin/settings/who-answers" className="text-sm underline">
            {intl.formatMessage({
              id: 'ask.destination.settings_who-answers',
              defaultMessage: 'Who answers',
            })}
          </Link>
        ) : (
          <AgentPauseControl
            deployment={{
              enabled: deployment?.enabled ?? true,
              respond: deployment?.respond ?? true,
            }}
            available={false}
            ticketsOn={Boolean(flags?.supportTickets)}
            onChange={() => {}}
          />
        )
      }
    >
      <div className="space-y-6">
        <AssistantIdentityCard />
        <AssistantVoiceCard />
        <AdditionalInstructionsCard />
      </div>
    </AssistantPageShell>
  )
}
