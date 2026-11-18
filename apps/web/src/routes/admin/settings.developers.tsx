import { lazy, Suspense } from 'react'
import { ClientOnly, createFileRoute, useNavigate } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { z } from 'zod'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { WorkspaceKeysSettings } from '@/components/admin/settings/api-keys/workspace-keys-settings'
import { PersonalKeysOversight } from '@/components/admin/settings/api-keys/personal-keys-oversight'
import { ApiReferenceCard } from '@/components/admin/settings/api-keys/api-reference-card'
import { WebhooksSettings } from '@/components/admin/settings/webhooks/webhooks-settings'
import { McpServerSettings } from '@/components/admin/settings/mcp/mcp-server-settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { settingsQueries } from '@/lib/client/queries/settings'
import { readBatch } from '@/lib/client/queries/read-batch'
import { useBaseUrl } from '@/lib/client/hooks/use-root-context'
import { adminPageHead } from '@/lib/client/admin-head'

// The two guides are long and sit on the Webhooks and MCP tabs, so they load
// with their tab rather than with the Keys tab every visit opens on.
const WebhookVerificationGuide = lazy(() =>
  import('@/components/admin/settings/webhooks/webhook-verification-guide').then((mod) => ({
    default: mod.WebhookVerificationGuide,
  }))
)
const McpSetupGuide = lazy(() =>
  import('@/components/admin/settings/mcp/mcp-setup-guide').then((mod) => ({
    default: mod.McpSetupGuide,
  }))
)

const searchSchema = z.object({
  tab: z.enum(['keys', 'webhooks', 'mcp']).optional(),
})

type ApiTab = 'keys' | 'webhooks' | 'mcp'

/** The tabs beyond Keys a viewer may open, by the permission each one's read needs. */
function developerTabs(permissions: readonly string[] | undefined) {
  return {
    webhooks: !!permissions?.includes(PERMISSIONS.WEBHOOK_VIEW),
    mcp: !!permissions?.includes(PERMISSIONS.SETTINGS_MANAGE),
  }
}

export const Route = createFileRoute('/admin/settings/developers')({
  head: adminPageHead('Developers settings'),
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.API_KEY_MANAGE)

    const { queryClient } = context
    // Every tab the viewer may open is preloaded so switching tabs never
    // round-trips for data: every payload is small and admin-only. Webhooks
    // need webhook.view and the MCP settings settings.manage, neither of which
    // api_key.manage implies; without one, its tab is not shown.
    const { listEntitlementsFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const tabs = developerTabs(context.permissions)
    const ensure = readBatch(queryClient)
    const [, entitlements] = await Promise.all([
      Promise.all([
        ensure(adminQueries.apiKeys()),
        tabs.webhooks ? ensure(adminQueries.webhooks()) : undefined,
        tabs.mcp ? ensure(settingsQueries.developerConfig()) : undefined,
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
  const navigate = useNavigate()
  const canViewWebhooks = usePermission(PERMISSIONS.WEBHOOK_VIEW)
  const canManageMcp = usePermission(PERMISSIONS.SETTINGS_MANAGE)
  const requested: ApiTab = search.tab ?? 'keys'
  const tab: ApiTab =
    (requested === 'webhooks' && !canViewWebhooks) || (requested === 'mcp' && !canManageMcp)
      ? 'keys'
      : requested

  const apiKeysQuery = useSuspenseQuery(adminQueries.apiKeys())
  const workspaceKeys = apiKeysQuery.data.keys.filter((k) => k.kind === 'workspace')
  const personalKeys = apiKeysQuery.data.keys.filter((k) => k.kind === 'personal')
  const webhooksQuery = useQuery({ ...adminQueries.webhooks(), enabled: canViewWebhooks })
  const developerConfigQuery = useQuery({
    ...settingsQueries.developerConfig(),
    enabled: canManageMcp,
  })

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
          {canViewWebhooks && <TabsTrigger value="webhooks">Webhooks</TabsTrigger>}
          {canManageMcp && <TabsTrigger value="mcp">MCP</TabsTrigger>}
        </TabsList>

        <TabsContent value="keys" className="space-y-6">
          <WorkspaceKeysSettings apiKeys={workspaceKeys} />
          {/* Below the fold: drawn once the page is live, which keeps the document small. */}
          <ClientOnly>
            <PersonalKeysOversight
              apiKeys={personalKeys}
              policyEnabled={apiKeysQuery.data.personalKeysEnabled}
            />
          </ClientOnly>
          <ApiReferenceCard apiBaseUrl={apiBaseUrl} />
        </TabsContent>

        {webhooksQuery.data && (
          <TabsContent value="webhooks" className="space-y-6">
            <WebhooksSettings webhooks={webhooksQuery.data} entitled={webhooksEntitled} />
            <Suspense fallback={null}>
              <WebhookVerificationGuide />
            </Suspense>
          </TabsContent>
        )}

        {developerConfigQuery.data && (
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
            <Suspense fallback={null}>
              <McpSetupGuide endpointUrl={mcpEndpointUrl} />
            </Suspense>
          </TabsContent>
        )}
      </Tabs>
    </SettingsPage>
  )
}
