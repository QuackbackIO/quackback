'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Loader2, Hash, Lock, RefreshCw } from 'lucide-react'
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

interface Channel {
  id: string
  name: string
  isPrivate: boolean
}

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
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [channels, setChannels] = useState<Channel[]>([])
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [channelError, setChannelError] = useState<string | null>(null)
  const [selectedChannel, setSelectedChannel] = useState(initialConfig.channelId || '')
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)
  const [eventSettings, setEventSettings] = useState<Record<string, boolean>>(() => {
    const settings: Record<string, boolean> = {}
    for (const event of EVENT_TYPES) {
      const mapping = initialEventMappings.find((m) => m.eventType === event.id)
      settings[event.id] = mapping?.enabled ?? true // Default to enabled
    }
    return settings
  })
  const [saving, setSaving] = useState(false)

  // Fetch channels on mount
  useEffect(() => {
    fetchChannels()
  }, [])

  const fetchChannels = async () => {
    setLoadingChannels(true)
    setChannelError(null)
    try {
      const res = await fetch('/api/integrations/slack/channels')
      if (!res.ok) {
        throw new Error('Failed to load channels')
      }
      const data = await res.json()
      setChannels(data.channels)
    } catch {
      setChannelError('Failed to load channels. Please try again.')
    } finally {
      setLoadingChannels(false)
    }
  }

  const saveConfig = async (updates: {
    enabled?: boolean
    channelId?: string
    eventMappings?: Array<{ eventType: string; enabled: boolean }>
  }) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/integrations/${integrationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: updates.enabled,
          config: updates.channelId !== undefined ? { channelId: updates.channelId } : undefined,
          eventMappings: updates.eventMappings,
        }),
      })
      if (res.ok) {
        startTransition(() => {
          router.invalidate()
        })
      }
    } finally {
      setSaving(false)
    }
  }

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    saveConfig({ enabled: checked })
  }

  const handleChannelChange = (channelId: string) => {
    setSelectedChannel(channelId)
    saveConfig({ channelId })
  }

  const handleEventToggle = (eventId: string, checked: boolean) => {
    const newSettings = { ...eventSettings, [eventId]: checked }
    setEventSettings(newSettings)
    saveConfig({
      eventMappings: Object.entries(newSettings).map(([eventType, enabled]) => ({
        eventType,
        enabled,
      })),
    })
  }

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
            <RefreshCw className={`h-3.5 w-3.5 ${loadingChannels ? 'animate-spin' : ''}`} />
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
                  <Loader2 className="h-4 w-4 animate-spin" />
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
                    {channel.isPrivate ? (
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
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
                checked={eventSettings[event.id] ?? true}
                onCheckedChange={(checked) => handleEventToggle(event.id, checked)}
                disabled={saving || !integrationEnabled}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Saving indicator */}
      {(saving || isPending) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}
    </div>
  )
}
