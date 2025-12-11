'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import { Slack, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { SlackConfig } from './slack-config'
import { getSlackConnectUrl } from './actions'

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
}

interface SlackIntegrationData {
  id: string
  status: string
  workspaceName?: string
  config: { channelId?: string }
  eventMappings: EventMapping[]
}

interface IntegrationListProps {
  organizationId: string
  slackIntegration: SlackIntegrationData | null
}

export function IntegrationList({ organizationId, slackIntegration }: IntegrationListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const params = useParams()
  const [, startTransition] = useTransition()
  const [showSuccess, setShowSuccess] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [connecting, setConnecting] = useState(false)

  // Show success message if redirected from OAuth
  useEffect(() => {
    const slackParam = searchParams.get('slack')
    if (slackParam === 'connected') {
      setShowSuccess(true)
      // Clear the URL param
      const url = new URL(window.location.href)
      url.searchParams.delete('slack')
      window.history.replaceState({}, '', url.toString())
      // Hide after 3 seconds
      setTimeout(() => setShowSuccess(false), 3000)
    }
  }, [searchParams])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      // Get signed URL from server action (validates session on tenant subdomain)
      const orgSlug = params.orgSlug as string
      const url = await getSlackConnectUrl(orgSlug)
      window.location.href = url
    } catch (err) {
      console.error('Failed to get connect URL:', err)
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!slackIntegration) return
    setDisconnecting(true)
    try {
      const res = await fetch(`/api/integrations/${slackIntegration.id}?orgId=${organizationId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        startTransition(() => {
          router.refresh()
        })
      }
    } finally {
      setDisconnecting(false)
    }
  }

  const isConnected = slackIntegration?.status === 'active'
  const isPaused = slackIntegration?.status === 'paused'

  return (
    <div className="space-y-4">
      {/* Success toast */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-5 w-5" />
          <span>Slack connected successfully!</span>
        </div>
      )}

      {/* Slack Integration Card */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            {/* Slack Logo */}
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#4A154B]">
              <Slack className="h-7 w-7 text-white" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">Slack</h3>
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
              {slackIntegration?.workspaceName && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Connected to <span className="font-medium">{slackIntegration.workspaceName}</span>
                </p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {!slackIntegration && (
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
            )}

            {slackIntegration && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={disconnecting}>
                    {disconnecting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      'Disconnect'
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect Slack?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove the Slack integration and stop all notifications. You can
                      reconnect at any time.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDisconnect}>Disconnect</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* Slack Configuration (when connected) */}
        {slackIntegration && (
          <div className="mt-6 border-t border-border/50 pt-6">
            <SlackConfig
              organizationId={organizationId}
              integrationId={slackIntegration.id}
              initialConfig={slackIntegration.config}
              initialEventMappings={slackIntegration.eventMappings}
              enabled={isConnected}
            />
          </div>
        )}
      </div>

      {/* More integrations coming soon */}
      <div className="rounded-xl border border-border/30 border-dashed bg-muted/30 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
            <ExternalLink className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-medium text-muted-foreground">More integrations coming soon</h3>
            <p className="text-sm text-muted-foreground/70">
              Linear, Discord, Jira, and more are on the roadmap.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
