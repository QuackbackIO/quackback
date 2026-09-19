import { useState } from 'react'
import { QuinnReviewQueue } from '@/components/admin/automation/quinn-review-queue'
import { Button } from '@/components/ui/button'
import { createFileRoute } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { ChartBarIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { CopilotUsageCard } from '@/components/admin/automation/copilot-usage-card'
import { QuinnPerformanceCard } from '@/components/admin/automation/quinn-performance-card'
import { QuinnOperationsCard } from '@/components/admin/automation/quinn-operations-card'
import { QuinnToolsCard } from '@/components/admin/automation/quinn-tools-card'
import { SupportPerformanceCard } from '@/components/admin/automation/support-performance-card'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

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
  const { permissions } = Route.useRouteContext()
  const [days, setDays] = useState<7 | 30>(7)
  const canViewConversations = (permissions ?? []).includes(PERMISSIONS.CONVERSATION_VIEW)

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
          id: 'automation.improve.title',
          defaultMessage: 'Improve',
        })}
        description={intl.formatMessage({
          id: 'automation.performance.description',
          defaultMessage: 'Understand how Quinn is helping over the last 30 days.',
        })}
      />
      {canViewConversations && (
        <>
          <div role="group" aria-label="Review period" className="flex gap-2">
            {([7, 30] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={days === value ? 'secondary' : 'ghost'}
                aria-pressed={days === value}
                onClick={() => setDays(value)}
              >
                {value} days
              </Button>
            ))}
          </div>
          <QuinnReviewQueue days={days} />
          <QuinnReviewQueue kind="live" title="Live now" days={days} />
        </>
      )}
      <QuinnPerformanceCard />
      <QuinnOperationsCard />
      <QuinnToolsCard />
      <CopilotUsageCard showActionsFunnel />
      <SupportPerformanceCard />
    </div>
  )
}
