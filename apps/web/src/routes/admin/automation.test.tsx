import { createFileRoute } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { BeakerIcon } from '@heroicons/react/24/solid'
import { z } from 'zod'
import { TestAgentCard } from '@/components/admin/automation/test-agent-card'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { PageHeader } from '@/components/shared/page-header'
import { BackLink } from '@/components/ui/back-link'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { ASSISTANT_TEST_AGENTS } from '@/lib/shared/assistant/test-agent-contract'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const searchSchema = z.object({
  agent: z.enum(ASSISTANT_TEST_AGENTS).optional(),
})

export const Route = createFileRoute('/admin/automation/test')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    const permissions = (context as { permissions?: PermissionKey[] }).permissions ?? []
    if (!permissions.includes(PERMISSIONS.ASSISTANT_MANAGE)) {
      throw new Error('Access denied: requires assistant.manage')
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(assistantQueries.settings())
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: AutomationTestPage,
})

function AutomationTestPage() {
  const intl = useIntl()
  const { agent } = Route.useSearch()
  return (
    <div className="max-w-3xl space-y-6">
      <div className="lg:hidden">
        <BackLink to="/admin/automation">
          {intl.formatMessage({ id: 'automation.nav.label', defaultMessage: 'AI & Automation' })}
        </BackLink>
      </div>
      <PageHeader
        icon={BeakerIcon}
        title={intl.formatMessage({ id: 'automation.test.title', defaultMessage: 'Test agent' })}
        description={intl.formatMessage({
          id: 'automation.test.description',
          defaultMessage:
            'Try realistic customer questions using your saved settings. Nothing here is added to your inbox or sent to customers.',
        })}
      />
      <TestAgentCard liveChannels={['widget']} initialAgent={agent ?? 'agent'} />
    </div>
  )
}
