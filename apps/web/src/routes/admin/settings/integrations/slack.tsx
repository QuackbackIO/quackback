import { createFileRoute, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowLeftIcon } from '@heroicons/react/24/solid'
import { adminQueries } from '@/lib/client/queries/admin'
import { SlackConnectionActions } from '@/components/admin/settings/integrations/slack/slack-connection-actions'
import { SlackConfig } from '@/components/admin/settings/integrations/slack/slack-config'
import { Badge } from '@/components/ui/badge'

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  )
}

export const Route = createFileRoute('/admin/settings/integrations/slack')({
  loader: async ({ context }) => {
    const { queryClient } = context

    // Pre-fetch Slack integration data
    await queryClient.ensureQueryData(adminQueries.integrationByType('slack'))

    return {}
  },
  component: SlackIntegrationPage,
})

function SlackIntegrationPage() {
  // Read pre-fetched data from React Query cache
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('slack'))
  const integration = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <Link
        to="/admin/settings/integrations"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to integrations
      </Link>

      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#4A154B]">
            <SlackIcon className="h-6 w-6 text-white" />
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
            <p className="text-sm text-muted-foreground">
              Get notified in Slack when users submit feedback or when statuses change.
            </p>
            {integration?.externalWorkspaceName && (
              <p className="mt-1 text-xs text-muted-foreground">
                Connected to{' '}
                <span className="font-medium">{integration.externalWorkspaceName}</span>
              </p>
            )}
          </div>
        </div>

        {/* Connection Actions */}
        <SlackConnectionActions
          integrationId={integration?.id}
          isConnected={isConnected || isPaused}
        />
      </div>

      {/* Configuration Section */}
      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <SlackConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {/* Not Connected State */}
      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <SlackIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect your Slack workspace</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Slack to receive notifications when users submit feedback, when post statuses
            change, and when changelogs are published.
          </p>
        </div>
      )}

      {/* Setup Instructions */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium text-foreground">Setup Instructions</h2>
        <div className="mt-4 space-y-4 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              1
            </span>
            <p>
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback to post messages to your Slack workspace.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>
              Select which channel notifications should be posted to. The bot must be added to
              private channels before they appear in the list.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>
              Choose which events trigger notifications. You can enable or disable individual event
              types at any time.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
