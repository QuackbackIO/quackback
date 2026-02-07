'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowPathIcon, FolderIcon } from '@heroicons/react/24/solid'
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
import { fetchLinearTeamsFn, type LinearTeam } from '@/lib/server/integrations/linear/functions'

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
}

interface LinearConfigProps {
  integrationId: string
  initialConfig: { channelId?: string }
  initialEventMappings: EventMapping[]
  enabled: boolean
}

const EVENT_CONFIG = [
  {
    id: 'post.created' as const,
    label: 'Create issue from new feedback',
    description: 'Automatically create a Linear issue when new feedback is submitted',
  },
  {
    id: 'post.status_changed' as const,
    label: 'Sync status changes',
    description: 'Update linked issues when feedback status changes',
  },
]

export function LinearConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  enabled,
}: LinearConfigProps) {
  const updateMutation = useUpdateIntegration()
  const [teams, setTeams] = useState<LinearTeam[]>([])
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [teamError, setTeamError] = useState<string | null>(null)
  const [selectedTeam, setSelectedTeam] = useState(initialConfig.channelId || '')
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)
  const [eventSettings, setEventSettings] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      EVENT_CONFIG.map((event) => [
        event.id,
        initialEventMappings.find((m) => m.eventType === event.id)?.enabled ?? false,
      ])
    )
  )

  const fetchTeams = useCallback(async () => {
    setLoadingTeams(true)
    setTeamError(null)
    try {
      const result = await fetchLinearTeamsFn()
      setTeams(result)
    } catch {
      setTeamError('Failed to load teams. Please try again.')
    } finally {
      setLoadingTeams(false)
    }
  }, [])

  useEffect(() => {
    fetchTeams()
  }, [fetchTeams])

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const handleTeamChange = (teamId: string) => {
    setSelectedTeam(teamId)
    updateMutation.mutate({ id: integrationId, config: { channelId: teamId } })
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
            Turn off to pause all Linear issue syncing
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
          <Label htmlFor="team-select">Team</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchTeams}
            disabled={loadingTeams}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingTeams ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        {teamError ? (
          <p className="text-sm text-destructive">{teamError}</p>
        ) : (
          <Select
            value={selectedTeam}
            onValueChange={handleTeamChange}
            disabled={loadingTeams || saving || !integrationEnabled}
          >
            <SelectTrigger id="team-select" className="w-full">
              {loadingTeams ? (
                <div className="flex items-center gap-2">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  <span>Loading teams...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select a team" />
              )}
            </SelectTrigger>
            <SelectContent>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  <div className="flex items-center gap-2">
                    <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>
                      {team.key} - {team.name}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          New feedback issues will be created in this team.
        </p>
      </div>

      <div className="space-y-3">
        <Label className="text-base font-medium">Events</Label>
        <p className="text-sm text-muted-foreground">Choose which events trigger issue creation</p>
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
