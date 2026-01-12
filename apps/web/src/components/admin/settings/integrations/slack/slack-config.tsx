import { useState, useEffect, useCallback } from 'react'
import { ArrowPathIcon, HashtagIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useUpdateIntegration } from '@/lib/hooks/use-integration-actions'
import { fetchSlackChannelsFn, type SlackChannel } from '@/lib/server-functions/integrations'

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
}

interface SlackConfigProps {
  integrationId: string
  initialConfig: { channelId?: string }
  initialEventMappings: EventMapping[]
  enabled: boolean
}

function ChannelIcon({ isPrivate }: { isPrivate: boolean }) {
  const Icon = isPrivate ? LockClosedIcon : HashtagIcon
  return <Icon className="h-3.5 w-3.5 text-muted-foreground" />
}

const EVENT_TYPES = [
  {
    id: 'post.created',
    label: 'New feedback submitted',
    description: 'When a user creates a new post',
  },
  {
    id: 'post.status_changed',
    label: 'Status changed',
    description: 'When a post status is updated',
  },
  { id: 'comment.created', label: 'New comment', description: 'When a comment is added to a post' },
  {
    id: 'changelog.published',
    label: 'Changelog published',
    description: 'When a changelog entry is published',
  },
]

export function SlackConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  enabled,
}: SlackConfigProps) {
  const updateMutation = useUpdateIntegration()
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [channelError, setChannelError] = useState<string | null>(null)
  const [selectedChannel, setSelectedChannel] = useState(initialConfig.channelId || '')
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)
  const [eventSettings, setEventSettings] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      EVENT_TYPES.map((event) => [
        event.id,
        initialEventMappings.find((m) => m.eventType === event.id)?.enabled ?? false,
      ])
    )
  )

  const fetchChannels = useCallback(async () => {
    setLoadingChannels(true)
    setChannelError(null)
    try {
      const result = await fetchSlackChannelsFn()
      setChannels(result)
    } catch {
      setChannelError('Failed to load channels. Please try again.')
    } finally {
      setLoadingChannels(false)
    }
  }, [])

  useEffect(() => {
    fetchChannels()
  }, [fetchChannels])

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const handleChannelChange = (channelId: string) => {
    setSelectedChannel(channelId)
    updateMutation.mutate({ id: integrationId, config: { channelId } })
  }

  const handleEventToggle = (eventId: string, checked: boolean) => {
    const newSettings = { ...eventSettings, [eventId]: checked }
    setEventSettings(newSettings)
    updateMutation.mutate({
      id: integrationId,
      eventMappings: Object.entries(newSettings).map(([eventType, enabled]) => ({
        eventType,
        enabled,
      })),
    })
  }

  const saving = updateMutation.isPending

  return (
    <div className="space-y-6">
      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Notifications enabled
          </Label>
          <p className="text-sm text-muted-foreground">Turn off to pause all Slack notifications</p>
        </div>
        <Switch
          id="enabled-toggle"
          checked={integrationEnabled}
          onCheckedChange={handleEnabledChange}
          disabled={saving}
        />
      </div>

      {/* Channel Selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="channel-select">Notification channel</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchChannels}
            disabled={loadingChannels}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingChannels ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        {channelError ? (
          <p className="text-sm text-destructive">{channelError}</p>
        ) : (
          <Select
            value={selectedChannel}
            onValueChange={handleChannelChange}
            disabled={loadingChannels || saving || !integrationEnabled}
          >
            <SelectTrigger id="channel-select" className="w-full">
              {loadingChannels ? (
                <div className="flex items-center gap-2">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  <span>Loading channels...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select a channel" />
              )}
            </SelectTrigger>
            <SelectContent>
              {channels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  <div className="flex items-center gap-2">
                    <ChannelIcon isPrivate={channel.isPrivate} />
                    <span>{channel.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          The bot will post notifications to this channel. Make sure the bot has access.
        </p>
      </div>

      {/* Event Toggles */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Events</Label>
        <p className="text-sm text-muted-foreground">Choose which events trigger notifications</p>
        <div className="space-y-3 pt-2">
          {EVENT_TYPES.map((event) => (
            <div
              key={event.id}
              className="flex items-center justify-between rounded-lg border border-border/50 p-3"
            >
              <div>
                <div className="font-medium text-sm">{event.label}</div>
                <div className="text-xs text-muted-foreground">{event.description}</div>
              </div>
              <Switch
                checked={eventSettings[event.id] ?? false}
                onCheckedChange={(checked) => handleEventToggle(event.id, checked)}
                disabled={saving || !integrationEnabled}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Saving indicator */}
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
