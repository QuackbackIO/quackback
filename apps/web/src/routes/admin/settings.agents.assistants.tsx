import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { McpServerSettings } from '@/components/admin/settings/mcp/mcp-server-settings'
import { McpSetupGuide } from '@/components/admin/settings/mcp/mcp-setup-guide'
import { settingsQueries } from '@/lib/client/queries/settings'
import { readBatch } from '@/lib/client/queries/read-batch'
import { useBaseUrl } from '@/lib/client/hooks/use-root-context'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/agents/assistants')({
  head: adminPageHead('Assistants settings'),
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.API_KEY_MANAGE)

    const { queryClient } = context
    const { hasEntitlementFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const ensure = readBatch(queryClient)
    const [, mcpEntitled] = await Promise.all([
      ensure(settingsQueries.developerConfig()),
      hasEntitlementFn({ data: { key: 'mcpServer' } }),
      ensureBillingCatalogue(queryClient, context.billingEnabled),
    ])

    return { mcpEntitled }
  },
  component: AssistantsPage,
})

function AssistantsPage() {
  const developerConfigQuery = useSuspenseQuery(settingsQueries.developerConfig())
  const baseUrl = useBaseUrl()
  const { mcpEntitled } = Route.useLoaderData()
  const mcpEndpointUrl = baseUrl ? `${baseUrl}/api/mcp` : '/api/mcp'

  return (
    <SettingsPage page="/admin/settings/agents/assistants">
      <SettingsCard>
        <McpServerSettings
          entitled={mcpEntitled}
          initialEnabled={developerConfigQuery.data.mcpEnabled}
          initialDynamicRegistrationEnabled={
            developerConfigQuery.data.oauthDynamicClientRegistrationEnabled
          }
        />
      </SettingsCard>
      <McpSetupGuide endpointUrl={mcpEndpointUrl} />
    </SettingsPage>
  )
}
