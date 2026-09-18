import { createFileRoute } from '@tanstack/react-router'
import { QuinnKnowledgeCard } from '@/components/admin/automation/assistant-knowledge-card'
import { QuinnSettingsPage } from '@/components/admin/automation/quinn-settings-page'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const Route = createFileRoute('/admin/automation/knowledge')({
  beforeLoad: ({ context }) => {
    if (!(context.permissions ?? []).includes(PERMISSIONS.ASSISTANT_MANAGE))
      throw new Error('Access denied: requires assistant.manage')
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(assistantQueries.settings())
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: () => (
    <QuinnSettingsPage
      title="Knowledge"
      description="Choose what Quinn can use for customers and teammates. Each source’s visibility still applies."
    >
      <QuinnKnowledgeCard />
    </QuinnSettingsPage>
  ),
})
