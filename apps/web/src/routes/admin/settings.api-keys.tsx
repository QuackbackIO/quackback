import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { KeyIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { DocsLink } from '@/components/ui/docs-link'
import { PageHeader } from '@/components/shared/page-header'
import { ApiKeysSettings } from '@/components/admin/settings/api-keys/api-keys-settings'
import { SettingsCard } from '@/components/admin/settings/settings-card'

export const Route = createFileRoute('/admin/settings/api-keys')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.apiKeys())

    return {}
  },
  component: ApiKeysPage,
})

function ApiKeysPage() {
  const apiKeysQuery = useSuspenseQuery(adminQueries.apiKeys())

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={KeyIcon}
        title="API Keys"
        description="Manage API keys for programmatic access to Quackback"
      />

      <SettingsCard
        title="API Keys"
        description="Create and manage API keys to authenticate with the Quackback REST API. Keys are shown only once when created."
      >
        <ApiKeysSettings apiKeys={apiKeysQuery.data} />
      </SettingsCard>

      <SettingsCard title="API Documentation" description="Learn how to use the Quackback API">
        <div className="text-sm text-muted-foreground space-y-3">
          <p>
            The Quackback API allows you to programmatically manage posts, boards, comments, and
            more.
          </p>
          <div className="flex flex-col gap-2">
            <DocsLink href="https://www.quackback.io/docs/api/overview">
              Learn how to set up API keys
            </DocsLink>
            <DocsLink href="/api/v1/docs">View API Reference</DocsLink>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
