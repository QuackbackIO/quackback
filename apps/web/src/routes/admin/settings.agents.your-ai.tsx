import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { OwnAgentSettings } from '@/components/admin/settings/agents/own-agent-settings'
import { supportAgentQueries } from '@/lib/client/queries/support-agents'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { adminPageHead } from '@/lib/client/admin-head'
export const Route = createFileRoute('/admin/settings/agents/your-ai')({
  head: adminPageHead('Your AI agent'),
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.API_KEY_MANAGE)
    if (context.settings?.featureFlags?.ownAgent)
      await context.queryClient.ensureQueryData(supportAgentQueries.config())
  },
  component: () => (
    <SettingsPage page="/admin/settings/agents/your-ai">
      <OwnAgentSettings />
    </SettingsPage>
  ),
})
