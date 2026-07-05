import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { settingsQueries } from '@/lib/client/queries/settings'
import { AssistantIdentityCard } from '@/components/admin/automation/assistant-identity-card'
import { SupportPerformanceCard } from '@/components/admin/automation/support-performance-card'

export const Route = createFileRoute('/admin/automation/assistant')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(settingsQueries.widgetConfig())
    return {}
  },
  component: AssistantPage,
})

/**
 * The AI agent's deploy page: identity (name + avatar) that fronts new
 * messenger conversations, plus its support-performance stats. Workflows and
 * the sandbox live on their own pages under the same area.
 */
function AssistantPage() {
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const assistant = widgetConfigQuery.data.messenger?.assistant

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/automation">AI &amp; Automation</BackLink>
      </div>
      <PageHeader
        icon={SparklesIcon}
        title="Assistant"
        description="Configure your AI assistant's identity and deployment"
      />

      <AssistantIdentityCard
        initial={{
          enabled: assistant?.enabled ?? true,
          respond: assistant?.respond ?? false,
          name: assistant?.name ?? 'Quinn',
          avatarUrl: assistant?.avatarUrl ?? '',
        }}
      />

      <SupportPerformanceCard />
    </div>
  )
}
