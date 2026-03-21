import { createFileRoute, useRouteContext } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { CommandLineIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { McpServerSettings } from '@/components/admin/settings/mcp/mcp-server-settings'
import { McpSetupGuide } from '@/components/admin/settings/mcp/mcp-setup-guide'
import { settingsQueries } from '@/lib/client/queries/settings'

export const Route = createFileRoute('/admin/settings/mcp')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.developerConfig())

    return {}
  },
  component: McpSettingsPage,
})

function useEndpointUrl() {
  const { baseUrl } = useRouteContext({ from: '__root__' })
  return baseUrl ? `${baseUrl}/api/mcp` : '/api/mcp'
}

function McpSettingsPage() {
  const developerConfigQuery = useSuspenseQuery(settingsQueries.developerConfig())
  const endpointUrl = useEndpointUrl()

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={CommandLineIcon}
        title="MCP Server"
        description="Allow AI tools to interact with your feedback data via the Model Context Protocol"
      />

      <SettingsCard
        title="MCP Server"
        description="Enable or disable the MCP endpoint for AI integrations"
      >
        <McpServerSettings initialEnabled={developerConfigQuery.data.mcpEnabled} />
      </SettingsCard>

      <McpSetupGuide endpointUrl={endpointUrl} />
    </div>
  )
}
