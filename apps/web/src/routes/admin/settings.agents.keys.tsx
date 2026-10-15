import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { ApiKeysSettings } from '@/components/admin/settings/api-keys/api-keys-settings'
import { ApiReferenceCard } from '@/components/admin/settings/api-keys/api-reference-card'
import { adminQueries } from '@/lib/client/queries/admin'
import { readBatch } from '@/lib/client/queries/read-batch'
import { useBaseUrl } from '@/lib/client/hooks/use-root-context'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/agents/keys')({
  head: adminPageHead('API keys settings'),
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.API_KEY_MANAGE)
    await readBatch(context.queryClient)(adminQueries.apiKeys())
    return {}
  },
  component: ApiKeysPage,
})

function ApiKeysPage() {
  const apiKeysQuery = useSuspenseQuery(adminQueries.apiKeys())
  const baseUrl = useBaseUrl()
  const apiBaseUrl = baseUrl ? `${baseUrl}/api/v1` : '/api/v1'

  return (
    <SettingsPage page="/admin/settings/agents/keys">
      <ApiKeysSettings apiKeys={apiKeysQuery.data} />
      <ApiReferenceCard apiBaseUrl={apiBaseUrl} />
    </SettingsPage>
  )
}
