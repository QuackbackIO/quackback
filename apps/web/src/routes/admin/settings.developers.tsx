import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ApiKeysSettings } from '@/components/admin/settings/api-keys/api-keys-settings'
import { ApiReferenceCard } from '@/components/admin/settings/api-keys/api-reference-card'
import { WebhooksSettings } from '@/components/admin/settings/webhooks/webhooks-settings'
import { WebhookVerificationGuide } from '@/components/admin/settings/webhooks/webhook-verification-guide'
import { McpServerSettings } from '@/components/admin/settings/mcp/mcp-server-settings'
import { McpSetupGuide } from '@/components/admin/settings/mcp/mcp-setup-guide'
import { adminQueries } from '@/lib/client/queries/admin'
import { settingsQueries } from '@/lib/client/queries/settings'
import { readBatch } from '@/lib/client/queries/read-batch'
import { useBaseUrl } from '@/lib/client/hooks/use-root-context'
import { adminPageHead } from '@/lib/client/admin-head'

const searchSchema = z.object({
  tab: z.enum(['keys', 'webhooks', 'mcp']).optional(),
})

type ApiTab = 'keys' | 'webhooks' | 'mcp'

export const Route = createFileRoute('/admin/settings/developers')({
  head: adminPageHead('Developers settings'),
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.API_KEY_MANAGE)

    const { queryClient } = context
    // All three tabs are preloaded so switching tabs never round-trips
    // for data: every payload is small and admin-only.
    const { listEntitlementsFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const ensure = readBatch(queryClient)
    const [, entitlements] = await Promise.all([
      Promise.all([
        ensure(adminQueries.apiKeys()),
        ensure(adminQueries.webhooks()),
        ensure(settingsQueries.developerConfig()),
      ]),
      listEntitlementsFn(),
      ensureBillingCatalogue(queryClient, context.billingEnabled),
    ])

    return { webhooksEntitled: entitlements.webhooks, mcpEntitled: entitlements.mcpServer }
  },
  component: ApiPage,
})

function ApiPage() {
  const search = Route.useSearch()
  const tab: ApiTab = search.tab ?? 'keys'
  const navigate = useNavigate()

  const apiKeysQuery = useSuspenseQuery(adminQueries.apiKeys())
  const webhooksQuery = useSuspenseQuery(adminQueries.webhooks())
  const developerConfigQuery = useSuspenseQuery(settingsQueries.developerConfig())

  const baseUrl = useBaseUrl()
  const { webhooksEntitled, mcpEntitled } = Route.useLoaderData()
  const apiBaseUrl = baseUrl ? `${baseUrl}/api/v1` : '/api/v1'
  const mcpEndpointUrl = baseUrl ? `${baseUrl}/api/mcp` : '/api/mcp'

  return (
    <SettingsPage page="/admin/settings/developers">
      <Tabs
        value={tab}
        onValueChange={(next) => {
          // Callback form preserves any other search params on the URL —
          // a literal `{ tab }` would silently strip them.
          void navigate({
            to: '/admin/settings/developers',
            search: (prev) => ({ ...prev, tab: next as ApiTab }),
            replace: true,
          })
        }}
        variant="line"
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="keys">Keys</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="space-y-6">
          <ApiKeysSettings apiKeys={apiKeysQuery.data} />
          <ApiReferenceCard apiBaseUrl={apiBaseUrl} />
        </TabsContent>

        <TabsContent value="webhooks" className="space-y-6">
          <WebhooksSettings webhooks={webhooksQuery.data} entitled={webhooksEntitled} />
          <WebhookVerificationGuide />
        </TabsContent>

        <TabsContent value="mcp" className="space-y-6">
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
        </TabsContent>
      </Tabs>
    </SettingsPage>
  )
}
