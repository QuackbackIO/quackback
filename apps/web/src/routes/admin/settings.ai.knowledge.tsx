import { createFileRoute } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { z } from 'zod'
import { AssistantPageShell } from '@/components/admin/automation/assistant-page-shell'
import { AudienceTabs } from '@/components/admin/automation/audience-tabs'
import {
  AgentKnowledgeCard,
  CopilotKnowledgeCard,
} from '@/components/admin/automation/assistant-knowledge-card'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { AI_ANY_PERMISSIONS } from '@/lib/shared/ai-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRouteAnyPermission } from '@/lib/shared/route-permission'
import { adminPageHead } from '@/lib/client/admin-head'

const searchSchema = z.object({
  tab: z.enum(['customers', 'teammates']).optional(),
})

export const Route = createFileRoute('/admin/settings/ai/knowledge')({
  head: adminPageHead('Quackback AI settings: Knowledge'),
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    assertRouteAnyPermission(context.permissions, AI_ANY_PERMISSIONS)
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(assistantQueries.settings())
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: KnowledgePage,
})

function KnowledgePage() {
  const intl = useIntl()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const canCustomers = usePermission(PERMISSIONS.AI_CUSTOMER_MANAGE)
  const canTeammates = usePermission(PERMISSIONS.AI_TEAMMATE_MANAGE)
  const tabs = [
    ...(canCustomers
      ? [
          {
            value: 'customers',
            label: intl.formatMessage({
              id: 'ai.audience.customers',
              defaultMessage: 'For customers',
            }),
            content: <AgentKnowledgeCard />,
          },
        ]
      : []),
    ...(canTeammates
      ? [
          {
            value: 'teammates',
            label: intl.formatMessage({
              id: 'ai.audience.teammates',
              defaultMessage: 'For teammates',
            }),
            content: <CopilotKnowledgeCard />,
          },
        ]
      : []),
  ]
  const current = tabs.some((item) => item.value === tab) ? tab! : tabs[0]!.value
  return (
    <AssistantPageShell page="/admin/settings/ai/knowledge">
      <AudienceTabs
        tabs={tabs}
        value={current}
        onValueChange={(next) =>
          void navigate({
            search: (previous) => ({ ...previous, tab: next as 'customers' | 'teammates' }),
            replace: true,
          })
        }
      />
    </AssistantPageShell>
  )
}
