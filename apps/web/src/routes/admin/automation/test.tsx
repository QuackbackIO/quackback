import { createFileRoute } from '@tanstack/react-router'
import { QuinnSandbox } from '@/components/admin/automation/quinn-sandbox'
import { QuinnReleaseReview } from '@/components/admin/automation/quinn-release-review'
import { QuinnSettingsPage } from '@/components/admin/automation/quinn-settings-page'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const Route = createFileRoute('/admin/automation/test')({
  beforeLoad: ({ context }) => {
    if (!(context.permissions ?? []).includes(PERMISSIONS.ASSISTANT_MANAGE))
      throw new Error('Access denied: requires assistant.manage')
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(assistantQueries.releaseState())
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: () => (
    <QuinnSettingsPage
      title="Test Quinn"
      description="Ask Quinn something without touching the inbox."
    >
      <QuinnSandbox />
      <QuinnReleaseReview />
    </QuinnSettingsPage>
  ),
})
