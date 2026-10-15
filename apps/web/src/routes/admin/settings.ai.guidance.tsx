import { createFileRoute } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { z } from 'zod'
import { AssistantPageShell } from '@/components/admin/automation/assistant-page-shell'
import { AudienceTabs } from '@/components/admin/automation/audience-tabs'
import { GuidanceRulesCard } from '@/components/admin/automation/guidance-rules-card'
import { SkillsManager } from '@/components/admin/automation/skills-manager'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { skillQueries } from '@/lib/client/queries/assistant-skills'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { AI_ANY_PERMISSIONS } from '@/lib/shared/ai-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRouteAnyPermission } from '@/lib/shared/route-permission'
import { adminPageHead } from '@/lib/client/admin-head'

const searchSchema = z.object({
  tab: z.enum(['customers', 'teammates', 'procedures']).optional(),
})
type GuidanceTab = 'customers' | 'teammates' | 'procedures'

export const Route = createFileRoute('/admin/settings/ai/guidance')({
  head: adminPageHead('Quackback AI settings: Guidance'),
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    assertRouteAnyPermission(context.permissions, AI_ANY_PERMISSIONS)
  },
  // The page reads its settings and the always-mounted tabs read the rules,
  // their stats and the skills. A failed warm is left to the page.
  loader: async ({ context }) => {
    const { queryClient } = context
    await Promise.all([
      queryClient.ensureQueryData(assistantQueries.settings()),
      warmQuery(queryClient, assistantQueries.guidanceRules()),
      warmQuery(queryClient, assistantQueries.guidanceRuleStats()),
      warmQuery(queryClient, skillQueries.list()),
    ])
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: GuidancePage,
})

function GuidancePage() {
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
            content: <GuidanceRulesCard agent="agent" />,
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
            content: <GuidanceRulesCard agent="copilot" />,
          },
        ]
      : []),
    {
      value: 'procedures',
      label: intl.formatMessage({ id: 'ai.guidance.procedures', defaultMessage: 'Procedures' }),
      content: <SkillsManager />,
    },
  ]
  const current = tabs.some((item) => item.value === tab) ? tab! : tabs[0]!.value
  return (
    <AssistantPageShell page="/admin/settings/ai/guidance">
      <AudienceTabs
        tabs={tabs}
        value={current}
        onValueChange={(next) =>
          void navigate({
            search: (previous) => ({ ...previous, tab: next as GuidanceTab }),
            replace: true,
          })
        }
      />
    </AssistantPageShell>
  )
}
