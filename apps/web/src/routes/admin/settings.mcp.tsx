import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { CommandLineIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { DocsLink } from '@/components/ui/docs-link'
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

    const { getBaseUrl } = await import('@/lib/server/config')
    return { baseUrl: getBaseUrl() }
  },
  component: McpSettingsPage,
})

function useEndpointUrl() {
  const { baseUrl } = Route.useLoaderData()
  if (baseUrl) return `${baseUrl}/api/mcp`
  if (typeof window !== 'undefined') return `${window.location.origin}/api/mcp`
  return '/api/mcp'
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

      <SettingsCard
        title="Setup Guide"
        description="Connect AI tools to your Quackback instance via MCP"
      >
        <div className="mb-4">
          <DocsLink href="https://www.quackback.io/docs/mcp" className="text-sm">
            Learn how to set up the MCP server
          </DocsLink>
        </div>
        <McpSetupGuide endpointUrl={endpointUrl} />
      </SettingsCard>
    </div>
  )
}
