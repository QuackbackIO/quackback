import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  )
}

// Integration definitions for the catalog
const INTEGRATIONS = [
  {
    id: 'slack',
    name: 'Slack',
    description: 'Get notified in Slack when users submit feedback or when statuses change.',
    icon: SlackIcon,
    iconBg: 'bg-[#4A154B]',
    to: '/admin/settings/integrations/slack',
    available: true,
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Send notifications to your Discord server channels.',
    iconBg: 'bg-[#5865F2]',
    to: '/admin/settings/integrations/discord',
    available: false,
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Sync feedback with Linear issues for seamless project management.',
    iconBg: 'bg-[#5E6AD2]',
    to: '/admin/settings/integrations/linear',
    available: false,
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Create and sync Jira issues from feedback posts.',
    iconBg: 'bg-[#0052CC]',
    to: '/admin/settings/integrations/jira',
    available: false,
  },
] as const

interface IntegrationStatus {
  id: string
  status: 'active' | 'paused' | 'error'
  workspaceName?: string
}

interface IntegrationListProps {
  integrations: IntegrationStatus[]
}

export function IntegrationList({ integrations }: IntegrationListProps) {
  const getIntegrationStatus = (integrationId: string) => {
    return integrations.find((i) => i.id === integrationId)
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {INTEGRATIONS.map((integration) => {
        const status = getIntegrationStatus(integration.id)
        const isConnected = status?.status === 'active'
        const isPaused = status?.status === 'paused'

        if (!integration.available) {
          // Coming soon card (still clickable to show detail page)
          return (
            <Link
              key={integration.id}
              to={integration.to}
              className="group rounded-xl border border-border/30 border-dashed bg-muted/20 p-5 opacity-70 transition-all hover:opacity-100 hover:border-border/50"
            >
              <div className="flex items-start gap-4">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${integration.iconBg}`}
                >
                  <span className="text-white font-semibold text-sm">
                    {integration.name.charAt(0)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-foreground">{integration.name}</h3>
                    <Badge variant="secondary" className="text-xs">
                      Coming soon
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                    {integration.description}
                  </p>
                </div>
                <ChevronRightIcon className="h-5 w-5 text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors flex-shrink-0 mt-0.5" />
              </div>
            </Link>
          )
        }

        // Available integration card
        return (
          <Link
            key={integration.id}
            to={integration.to}
            className="group rounded-xl border border-border/50 bg-card p-5 shadow-sm transition-all hover:border-border hover:shadow-md"
          >
            <div className="flex items-start gap-4">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${integration.iconBg}`}
              >
                {integration.icon && <integration.icon className="h-5 w-5 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-foreground">{integration.name}</h3>
                  {isConnected && (
                    <Badge variant="outline" className="border-green-500/30 text-green-600 text-xs">
                      Connected
                    </Badge>
                  )}
                  {isPaused && (
                    <Badge
                      variant="outline"
                      className="border-yellow-500/30 text-yellow-600 text-xs"
                    >
                      Paused
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  {integration.description}
                </p>
                {status?.workspaceName && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Connected to <span className="font-medium">{status.workspaceName}</span>
                  </p>
                )}
              </div>
              <ChevronRightIcon className="h-5 w-5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors flex-shrink-0 mt-0.5" />
            </div>
          </Link>
        )
      })}
    </div>
  )
}
