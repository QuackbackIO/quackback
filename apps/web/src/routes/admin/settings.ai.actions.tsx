import { createFileRoute } from '@tanstack/react-router'
import { ConnectorsManager } from '@/components/admin/automation/connectors/connectors-manager'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { connectorQueries } from '@/lib/client/queries/assistant-connectors'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { AI_ANY_PERMISSIONS } from '@/lib/shared/ai-permissions'
import { assertRouteAnyPermission } from '@/lib/shared/route-permission'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/ai/actions')({
  head: adminPageHead('Quackback AI settings: Actions'),
  beforeLoad: ({ context }) => {
    assertRouteAnyPermission(context.permissions, AI_ANY_PERMISSIONS)
  },
  loader: async ({ context }) => {
    const { queryClient } = context
    // The built-in tools card reads the assistant settings and the tool catalogue.
    await Promise.all([
      queryClient.ensureQueryData(connectorQueries.list()),
      warmQuery(queryClient, assistantQueries.settings()),
      warmQuery(queryClient, assistantQueries.tools()),
    ])
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: ConnectorsManager,
})
