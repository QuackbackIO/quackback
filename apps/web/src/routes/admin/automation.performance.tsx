import { createFileRoute } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { ChartBarIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { CopilotUsageCard } from '@/components/admin/automation/copilot-usage-card'
import { QuinnPerformanceCard } from '@/components/admin/automation/quinn-performance-card'
import { QuinnToolsCard } from '@/components/admin/automation/quinn-tools-card'
import { SupportPerformanceCard } from '@/components/admin/automation/support-performance-card'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { FeatureFlags } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/automation/performance')({
  beforeLoad: ({ context }) => {
    const permissions = (context as { permissions?: PermissionKey[] }).permissions ?? []
    if (!permissions.includes(PERMISSIONS.ANALYTICS_VIEW)) {
      throw new Error('Access denied: requires analytics.view')
    }
  },
  component: AutomationPerformancePage,
})

function AutomationPerformancePage() {
  const intl = useIntl()
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined

  return (
    <div className="max-w-5xl space-y-6">
      <div className="lg:hidden">
        <BackLink to="/admin/automation">
          {intl.formatMessage({ id: 'automation.nav.label', defaultMessage: 'AI & Automation' })}
        </BackLink>
      </div>
      <PageHeader
        icon={ChartBarIcon}
        title={intl.formatMessage({
          id: 'automation.performance.title',
          defaultMessage: 'AI performance',
        })}
        description={intl.formatMessage({
          id: 'automation.performance.description',
          defaultMessage:
            'Understand how the AI agent and Copilot are helping over the last 30 days.',
        })}
      />
      <QuinnPerformanceCard />
      <QuinnToolsCard />
      {flags?.inboxAi && <CopilotUsageCard showActionsFunnel={Boolean(flags.assistantTools)} />}
      <SupportPerformanceCard />
    </div>
  )
}
