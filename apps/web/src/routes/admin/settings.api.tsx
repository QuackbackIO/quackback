import { createFileRoute, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { KeyIcon, BoltIcon, CommandLineIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ApiKeysSettings } from '@/components/admin/settings/api-keys/api-keys-settings'
import { ApiUsageGuide } from '@/components/admin/settings/api-keys/api-usage-guide'
import { WebhooksSettings } from '@/components/admin/settings/webhooks/webhooks-settings'
import { WebhookVerificationGuide } from '@/components/admin/settings/webhooks/webhook-verification-guide'
import { McpServerSettings } from '@/components/admin/settings/mcp/mcp-server-settings'
import { McpSetupGuide } from '@/components/admin/settings/mcp/mcp-setup-guide'
import { adminQueries } from '@/lib/client/queries/admin'
import { settingsQueries } from '@/lib/client/queries/settings'

const searchSchema = z.object({
  tab: z.enum(['keys', 'webhooks', 'mcp']).optional(),
})

type ApiTab = 'keys' | 'webhooks' | 'mcp'

export const Route = createFileRoute('/admin/settings/api')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    // All three tabs are preloaded so switching tabs never round-trips
    // for data — every payload is small and admin-only.
    await Promise.all([
      queryClient.ensureQueryData(adminQueries.apiKeys()),
      queryClient.ensureQueryData(adminQueries.webhooks()),
      queryClient.ensureQueryData(settingsQueries.developerConfig()),
    ])

    return {}
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

  const { baseUrl } = useRouteContext({ from: '__root__' })
  const apiBaseUrl = baseUrl ? `${baseUrl}/api/v1` : '/api/v1'
  const mcpEndpointUrl = baseUrl ? `${baseUrl}/api/mcp` : '/api/mcp'

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={KeyIcon}
        title="API"
        description="API keys, webhooks, and the MCP server for programmatic integrations."
      />

      <Tabs
        value={tab}
        onValueChange={(next) => {
          // Callback form preserves any other search params on the URL —
          // a literal `{ tab }` would silently strip them.
          void navigate({
            to: '/admin/settings/api',
            search: (prev) => ({ ...prev, tab: next as ApiTab }),
            replace: true,
          })
        }}
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="keys">
            <KeyIcon />
            Keys
          </TabsTrigger>
          <TabsTrigger value="webhooks">
            <BoltIcon />
            Webhooks
          </TabsTrigger>
          <TabsTrigger value="mcp">
            <CommandLineIcon />
            MCP
          </TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="space-y-6">
          <SettingsCard
            title="API Keys"
            description="Create and manage API keys to authenticate with the Quackback REST API. Keys are shown only once when created."
          >
            <ApiKeysSettings apiKeys={apiKeysQuery.data} />
          </SettingsCard>
          <ApiUsageGuide apiBaseUrl={apiBaseUrl} />
        </TabsContent>

        <TabsContent value="webhooks" className="space-y-6">
          <SettingsCard
            title="Configured Webhooks"
            description="Webhooks receive HTTP POST requests when events happen in your workspace."
          >
            <WebhooksSettings webhooks={webhooksQuery.data} />
          </SettingsCard>
          <WebhookVerificationGuide />
        </TabsContent>

        <TabsContent value="mcp" className="space-y-6">
          <SettingsCard
            title="MCP Server"
            description="Enable or disable the MCP endpoint for AI integrations."
          >
            <McpServerSettings initialEnabled={developerConfigQuery.data.mcpEnabled} />
          </SettingsCard>
          <McpSetupGuide endpointUrl={mcpEndpointUrl} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
