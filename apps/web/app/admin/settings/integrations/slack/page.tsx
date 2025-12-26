import Link from 'next/link'
import { requireTenantRole } from '@/lib/tenant'
import { ArrowLeft, Slack } from 'lucide-react'
import { db, integrations, integrationEventMappings, eq } from '@/lib/db'
import { Badge } from '@/components/ui/badge'
import { SlackConfig } from './slack-config'
import { SlackConnectionActions } from './slack-connection-actions'

export default async function SlackIntegrationPage() {
  // Validate tenant role
  await requireTenantRole(['owner', 'admin'])

  // Fetch Slack integration
  const slackIntegration = await db.query.integrations.findFirst({
    where: eq(integrations.integrationType, 'slack'),
  })

  // Get event mappings if integration exists
  const eventMappings = slackIntegration
    ? await db.query.integrationEventMappings.findMany({
        where: eq(integrationEventMappings.integrationId, slackIntegration.id),
      })
    : []

  const isConnected = slackIntegration?.status === 'active'
  const isPaused = slackIntegration?.status === 'paused'

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <Link
        href="/admin/settings/integrations"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Integrations
      </Link>

      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#4A154B]">
            <Slack className="h-7 w-7 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">Slack</h1>
              {isConnected && (
                <Badge variant="outline" className="border-green-500/30 text-green-600">
                  Connected
                </Badge>
              )}
              {isPaused && (
                <Badge variant="outline" className="border-yellow-500/30 text-yellow-600">
                  Paused
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Get notified in Slack when users submit feedback or when statuses change.
            </p>
            {slackIntegration?.externalWorkspaceName && (
              <p className="mt-2 text-sm text-muted-foreground">
                Connected to{' '}
                <span className="font-medium">{slackIntegration.externalWorkspaceName}</span>
              </p>
            )}
          </div>
        </div>

        {/* Connection Actions */}
        <SlackConnectionActions
          integrationId={slackIntegration?.id}
          isConnected={!!slackIntegration}
        />
      </div>

      {/* Configuration Section */}
      {slackIntegration && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="text-lg font-medium mb-4">Configuration</h2>
          <SlackConfig
            integrationId={slackIntegration.id}
            initialConfig={slackIntegration.config as { channelId?: string }}
            initialEventMappings={eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {/* Not Connected State */}
      {!slackIntegration && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="text-center py-8">
            <Slack className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-medium mb-2">Connect Slack to get started</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Connect your Slack workspace to receive notifications when users submit feedback,
              statuses change, comments are added, and changelogs are published.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
