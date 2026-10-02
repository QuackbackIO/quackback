import { useCallback } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationDetail } from '@/components/admin/settings/integrations/integration-detail'
import { getIntegrationSettingsEntry } from '@/components/admin/settings/integrations/integration-settings-registry'

/** URL segments use hyphens (e.g. `azure-devops`); registry keys use the
 * underscore integration type (`azure_devops`). Every other provider is a
 * single token, so a blanket hyphen→underscore swap is safe. */
function toIntegrationType(param: string): string {
  return param.replace(/-/g, '_')
}

export const Route = createFileRoute('/admin/settings/integrations/$type')({
  validateSearch: (search: Record<string, unknown>): { tab?: 'history' } => ({
    tab: search.tab === 'history' ? 'history' : undefined,
  }),
  loader: async ({ context, params }) => {
    const type = toIntegrationType(params.type)
    // Loaded on demand: a static import would put every provider's settings
    // UI in the route module, which every page loads eagerly.
    const { getIntegrationSettingsEntry } =
      await import('@/components/admin/settings/integrations/integration-settings-registry')
    if (!getIntegrationSettingsEntry(type)) throw notFound()
    await context.queryClient.ensureQueryData(adminQueries.integrationByType(type))
    return {}
  },
  component: IntegrationSettingsPage,
})

function IntegrationSettingsPage() {
  const { type: param } = Route.useParams()
  const type = toIntegrationType(param)
  const entry = getIntegrationSettingsEntry(type)
  if (!entry) throw notFound()

  const { data } = useSuspenseQuery(adminQueries.integrationByType(type))
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const clearTab = useCallback(
    () => void navigate({ search: (previous) => ({ ...previous, tab: undefined }), replace: true }),
    [navigate]
  )

  return (
    <IntegrationDetail
      type={type}
      entry={entry}
      data={data}
      historyRequested={tab === 'history'}
      onHistoryHandled={clearTab}
    />
  )
}
