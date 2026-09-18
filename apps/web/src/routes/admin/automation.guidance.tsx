import { createFileRoute } from '@tanstack/react-router'
import { GuidanceList } from '@/components/admin/automation/guidance-list'
import { QuinnSettingsPage } from '@/components/admin/automation/quinn-settings-page'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { skillQueries } from '@/lib/client/queries/assistant-skills'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const Route = createFileRoute('/admin/automation/guidance')({
  beforeLoad: ({ context }) => {
    if (!(context.permissions ?? []).includes(PERMISSIONS.ASSISTANT_MANAGE))
      throw new Error('Access denied: requires assistant.manage')
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(assistantQueries.settings()),
      context.queryClient.ensureQueryData(assistantQueries.guidanceRules()),
      context.queryClient.ensureQueryData(skillQueries.list()),
    ])
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: () => (
    <QuinnSettingsPage
      title="Guidance"
      description="Teach Quinn how to respond in everyday conversations and specific situations."
    >
      <GuidanceList />
    </QuinnSettingsPage>
  ),
})
