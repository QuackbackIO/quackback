'use client'

import Link from 'next/link'
import { Slack, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

// Integration definitions for the catalog
const INTEGRATIONS = [
  {
    id: 'slack',
    name: 'Slack',
    description: 'Get notified in Slack when users submit feedback or when statuses change.',
    icon: Slack,
    iconBg: 'bg-[#4A154B]',
    href: '/admin/settings/integrations/slack',
    available: true,
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Send notifications to your Discord server channels.',
    iconBg: 'bg-[#5865F2]',
    href: '/admin/settings/integrations/discord',
    available: false,
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Sync feedback with Linear issues for seamless project management.',
    iconBg: 'bg-[#5E6AD2]',
    href: '/admin/settings/integrations/linear',
    available: false,
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Create and sync Jira issues from feedback posts.',
    iconBg: 'bg-[#0052CC]',
    href: '/admin/settings/integrations/jira',
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
              href={integration.href}
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
                <ChevronRight className="h-5 w-5 text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors flex-shrink-0 mt-0.5" />
              </div>
            </Link>
          )
        }

        // Available integration card
        return (
          <Link
            key={integration.id}
            href={integration.href}
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
              <ChevronRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors flex-shrink-0 mt-0.5" />
            </div>
          </Link>
        )
      })}
    </div>
  )
}
