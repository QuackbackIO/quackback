import { requireTenantRoleBySlug } from '@/lib/tenant'
import { Plug2 } from 'lucide-react'
import { db, organizationIntegrations, integrationEventMappings, eq } from '@quackback/db'
import { IntegrationList } from './integration-list'

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { organization } = await requireTenantRoleBySlug(orgSlug, ['owner', 'admin'])

  // Fetch existing integrations
  const integrations = await db.query.organizationIntegrations.findMany({
    where: eq(organizationIntegrations.organizationId, organization.id),
  })

  // Get event mappings for each integration
  const integrationIds = integrations.map((i) => i.id)
  const allMappings =
    integrationIds.length > 0
      ? await db.query.integrationEventMappings.findMany({
          where: eq(integrationEventMappings.integrationId, integrationIds[0]),
        })
      : []

  // Build mappings by integration
  const mappingsByIntegration = integrations.reduce(
    (acc, integration) => {
      acc[integration.id] = allMappings.filter((m) => m.integrationId === integration.id)
      return acc
    },
    {} as Record<string, typeof allMappings>
  )

  // Build Slack integration data
  const slackIntegration = integrations.find((i) => i.integrationType === 'slack')

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Plug2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Connect external services to automate workflows
          </p>
        </div>
      </div>

      {/* Integration List */}
      <IntegrationList
        organizationId={organization.id}
        slackIntegration={
          slackIntegration
            ? {
                id: slackIntegration.id,
                status: slackIntegration.status,
                workspaceName: slackIntegration.externalWorkspaceName || undefined,
                config: slackIntegration.config as { channelId?: string },
                eventMappings: mappingsByIntegration[slackIntegration.id] || [],
              }
            : null
        }
      />
    </div>
  )
}
