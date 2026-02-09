import { useState, useEffect, useCallback } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
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
import { useUpdateIntegration } from '@/lib/client/mutations'
import {
  fetchNotionDatabasesFn,
  type NotionDatabase,
} from '@/lib/server/integrations/notion/functions'

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
}

interface NotionConfigProps {
  integrationId: string
  initialConfig: { channelId?: string }
  initialEventMappings: EventMapping[]
  enabled: boolean
}

const EVENT_CONFIG = [
  {
    id: 'post.created' as const,
    label: 'New feedback submitted',
    description: 'Create a database item when a user submits new feedback',
  },
]

export function NotionConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  enabled,
}: NotionConfigProps) {
  const updateMutation = useUpdateIntegration()
  const [databases, setDatabases] = useState<NotionDatabase[]>([])
  const [loadingDatabases, setLoadingDatabases] = useState(false)
  const [databaseError, setDatabaseError] = useState<string | null>(null)
  const [selectedDatabase, setSelectedDatabase] = useState(initialConfig.channelId || '')
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)
  const [eventSettings, setEventSettings] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      EVENT_CONFIG.map((event) => [
        event.id,
        initialEventMappings.find((m) => m.eventType === event.id)?.enabled ?? false,
      ])
    )
  )

  const fetchDatabases = useCallback(async () => {
    setLoadingDatabases(true)
    setDatabaseError(null)
    try {
      const result = await fetchNotionDatabasesFn()
      setDatabases(result)
    } catch {
      setDatabaseError('Failed to load databases. Please try again.')
    } finally {
      setLoadingDatabases(false)
    }
  }, [])

  useEffect(() => {
    fetchDatabases()
  }, [fetchDatabases])

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const handleDatabaseChange = (databaseId: string) => {
    setSelectedDatabase(databaseId)
    updateMutation.mutate({ id: integrationId, config: { channelId: databaseId } })
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
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Integration enabled
          </Label>
          <p className="text-sm text-muted-foreground">
            Turn off to pause creating Notion items from feedback
          </p>
        </div>
        <Switch
          id="enabled-toggle"
          checked={integrationEnabled}
          onCheckedChange={handleEnabledChange}
          disabled={saving}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="database-select">Target database</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchDatabases}
            disabled={loadingDatabases}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingDatabases ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        {databaseError ? (
          <p className="text-sm text-destructive">{databaseError}</p>
        ) : (
          <Select
            value={selectedDatabase}
            onValueChange={handleDatabaseChange}
            disabled={loadingDatabases || saving || !integrationEnabled}
          >
            <SelectTrigger id="database-select" className="w-full">
              {loadingDatabases ? (
                <div className="flex items-center gap-2">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  <span>Loading databases...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select a database" />
              )}
            </SelectTrigger>
            <SelectContent>
              {databases.map((database) => (
                <SelectItem key={database.id} value={database.id}>
                  {database.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          New feedback will be added as items in this database. The database must have a Title
          property.
        </p>
      </div>

      <div className="space-y-3">
        <Label className="text-base font-medium">Events</Label>
        <p className="text-sm text-muted-foreground">Choose which events create database items</p>
        <div className="space-y-3 pt-2">
          {EVENT_CONFIG.map((event) => (
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
