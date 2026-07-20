import { useState } from 'react'
import { ArrowPathIcon, HashtagIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useUpdateIntegration } from '@/lib/client/mutations'
import { adminQueries } from '@/lib/client/queries/admin'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSlackChannelsFn, type SlackChannel } from '@/integrations/slack/server/functions'
import {
  NotificationChannelRouter,
  type NotificationChannel,
} from '@/components/admin/settings/integrations/shared/notification-channel-router'

// ============================================
// Types
// ============================================

interface SlackConfigProps {
  integrationId: string
  initialConfig: { channelId?: string; scopes?: string }
  initialEventMappings: { id: string; eventType: string; enabled: boolean }[]
  notificationChannels?: NotificationChannel[]
  enabled: boolean
}

// ============================================
// Constants
// ============================================

const SLACK_EVENT_CONFIG = [
  {
    id: 'post.created' as const,
    label: 'New post submitted',
    shortLabel: 'New post',
    description: 'When someone submits a new post',
  },
  {
    id: 'post.status_changed' as const,
    label: 'Post status changed',
    shortLabel: 'Status',
    description: "When a post's status is updated",
  },
  {
    id: 'comment.created' as const,
    label: 'New comment posted',
    shortLabel: 'Comment',
    description: 'When someone comments on a post',
  },
  {
    id: 'changelog.published' as const,
    label: 'Changelog published',
    shortLabel: 'Changelog',
    description: 'When a changelog entry is published',
  },
]

// ============================================
// Helpers
// ============================================

function useSlackChannels() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['slack-channels'],
    queryFn: () => fetchSlackChannelsFn({ data: { force: false } }),
    staleTime: 5 * 60 * 1000, // 5 minutes — matches server-side Dragonfly TTL
    retry: 1,
  })

  const refresh = () => {
    queryClient.fetchQuery({
      queryKey: ['slack-channels'],
      queryFn: () => fetchSlackChannelsFn({ data: { force: true } }),
    })
  }

  return {
    channels: query.data ?? [],
    loading: query.isLoading || query.isFetching,
    error: query.isError ? 'Failed to load channels. Please try again.' : null,
    refresh,
  }
}

// ============================================
// Main Component
// ============================================

export function SlackConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  notificationChannels: initialChannels,
  enabled,
}: SlackConfigProps) {
  const updateMutation = useUpdateIntegration()
  const {
    channels,
    loading: loadingChannels,
    error: channelError,
    refresh: refreshChannels,
  } = useSlackChannels()
  const boardsQuery = useQuery(adminQueries.boards())
  const boards = (boardsQuery.data ?? []).map((b) => ({ id: b.id, name: b.name }))
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)

  // Use notificationChannels if available, otherwise fall back to legacy single-channel
  const notificationChannels: NotificationChannel[] = initialChannels?.length
    ? initialChannels
    : initialConfig.channelId
      ? [
          {
            channelId: initialConfig.channelId,
            events: SLACK_EVENT_CONFIG.map((e) => ({
              eventType: e.id,
              enabled: initialEventMappings.find((m) => m.eventType === e.id)?.enabled ?? false,
            })),
            boardIds: null,
          },
        ]
      : []

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const saving = updateMutation.isPending

  return (
    <div className="space-y-6">
      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Integration enabled
          </Label>
          <p className="text-xs text-muted-foreground">Turn off to pause all Slack features</p>
        </div>
        <Switch
          id="enabled-toggle"
          checked={integrationEnabled}
          onCheckedChange={handleEnabledChange}
          disabled={saving}
        />
      </div>

      <div className="border-t border-border/30" />

      {/* Notification Routing */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-medium">Notification routing</Label>
          <p className="text-xs text-muted-foreground">
            Choose which events reach each Slack channel
          </p>
        </div>

        <NotificationChannelRouter<SlackChannel>
          integrationId={integrationId}
          enabled={integrationEnabled}
          events={SLACK_EVENT_CONFIG}
          channels={channels}
          notificationChannels={notificationChannels}
          boards={boards}
          loadingChannels={loadingChannels}
          channelError={channelError}
          onRefreshChannels={refreshChannels}
          renderChannelIcon={(channel) => {
            const Icon = channel?.isPrivate ? LockClosedIcon : HashtagIcon
            return <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          }}
        />
      </div>

      {/* Saving indicator (for enable/disable toggle) */}
      {saving && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      {/* Error message */}
      {updateMutation.isError && (
        <div className="text-sm text-destructive">
          {updateMutation.error?.message || 'Failed to save changes'}
        </div>
      )}
    </div>
  )
}
