import { useMemo, useState } from 'react'
import { ArrowPathIcon, HashtagIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useUpdateIntegration } from '@/lib/client/mutations'
import { adminQueries } from '@/lib/client/queries/admin'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchDiscordChannelsFn,
  type DiscordChannel,
} from '@/lib/server/integrations/discord/functions'
import {
  NotificationChannelRouter,
  type NotificationChannel,
  type EventConfig,
} from '@/components/admin/settings/integrations/shared/notification-channel-router'

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
}

interface DiscordConfigProps {
  integrationId: string
  initialConfig: { channelId?: string }
  initialEventMappings: EventMapping[]
  notificationChannels?: NotificationChannel[]
  enabled: boolean
}

const DISCORD_EVENT_CONFIG: EventConfig[] = [
  {
    id: 'post.created',
    label: 'New post submitted',
    shortLabel: 'New post',
    description: 'When someone submits a new post',
  },
  {
    id: 'post.status_changed',
    label: 'Post status changed',
    shortLabel: 'Status',
    description: "When a post's status is updated",
  },
  {
    id: 'comment.created',
    label: 'New comment posted',
    shortLabel: 'Comment',
    description: 'When someone comments on a post',
  },
]

function useDiscordChannels() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['discord-channels'],
    queryFn: () => fetchDiscordChannelsFn(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const refresh = () => {
    queryClient.fetchQuery({
      queryKey: ['discord-channels'],
      queryFn: () => fetchDiscordChannelsFn(),
    })
  }

  return {
    channels: query.data ?? [],
    loading: query.isLoading || query.isFetching,
    error: query.isError ? 'Failed to load channels. Please try again.' : null,
    refresh,
  }
}

export function DiscordConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  notificationChannels: initialChannels,
  enabled,
}: DiscordConfigProps) {
  const updateMutation = useUpdateIntegration()
  const {
    channels,
    loading: loadingChannels,
    error: channelError,
    refresh: refreshChannels,
  } = useDiscordChannels()
  const boardsQuery = useQuery(adminQueries.boards())
  const boards = useMemo(
    () => (boardsQuery.data ?? []).map((b) => ({ id: b.id, name: b.name })),
    [boardsQuery.data]
  )
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)

  // Use notificationChannels if provided; otherwise synthesize from legacy
  // single-channel config so the user can keep editing without re-adding.
  const notificationChannels: NotificationChannel[] = initialChannels?.length
    ? initialChannels
    : initialConfig.channelId
      ? [
          {
            channelId: initialConfig.channelId,
            events: DISCORD_EVENT_CONFIG.map((e) => ({
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
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Notifications enabled
          </Label>
          <p className="text-sm text-muted-foreground">
            Turn off to pause all Discord notifications
          </p>
        </div>
        <Switch
          id="enabled-toggle"
          checked={integrationEnabled}
          onCheckedChange={handleEnabledChange}
          disabled={saving}
        />
      </div>

      <div className="border-t border-border/30" />

      <div className="space-y-3">
        <div>
          <Label className="text-base font-medium">Notification routing</Label>
          <p className="text-sm text-muted-foreground">
            Choose which events reach each Discord channel
          </p>
        </div>

        <NotificationChannelRouter<DiscordChannel>
          integrationId={integrationId}
          enabled={integrationEnabled}
          events={DISCORD_EVENT_CONFIG}
          channels={channels}
          notificationChannels={notificationChannels}
          boards={boards}
          loadingChannels={loadingChannels}
          channelError={channelError}
          onRefreshChannels={refreshChannels}
          renderChannelIcon={() => <HashtagIcon className="h-3.5 w-3.5 text-muted-foreground" />}
        />
      </div>

      {saving && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      {updateMutation.isError && (
        <div className="text-sm text-destructive">
          {updateMutation.error?.message || 'Failed to save changes'}
        </div>
      )}
    </div>
  )
}
