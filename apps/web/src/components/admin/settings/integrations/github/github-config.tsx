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
import { fetchGitHubReposFn, type GitHubRepo } from '@/lib/server/integrations/github/functions'
import { StatusSyncConfig } from '@/components/admin/settings/integrations/status-sync-config'
import { TicketStatusSyncConfig } from '@/components/admin/settings/integrations/ticket-status-sync-config'
import { OnDeleteConfig } from '@/components/admin/settings/integrations/on-delete-config'

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
}

interface GitHubConfigProps {
  integrationId: string
  initialConfig: Record<string, unknown>
  initialEventMappings: EventMapping[]
  enabled: boolean
}

const EVENT_CONFIG = [
  {
    id: 'post.created' as const,
    label: 'Create issue from new feedback',
    description: 'Automatically create a GitHub issue when new feedback is submitted',
  },
  {
    id: 'post.status_changed' as const,
    label: 'Sync status changes',
    description: 'Update linked issues when feedback status changes',
  },
]

export function GitHubConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  enabled,
}: GitHubConfigProps) {
  const updateMutation = useUpdateIntegration()
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [selectedRepo, setSelectedRepo] = useState((initialConfig.channelId as string) || '')
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)
  const [eventSettings, setEventSettings] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      EVENT_CONFIG.map((event) => [
        event.id,
        initialEventMappings.find((m) => m.eventType === event.id)?.enabled ?? false,
      ])
    )
  )

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true)
    setRepoError(null)
    try {
      const result = await fetchGitHubReposFn()
      setRepos(result)
    } catch {
      setRepoError('Failed to load repositories. Please try again.')
    } finally {
      setLoadingRepos(false)
    }
  }, [])

  useEffect(() => {
    fetchRepos()
  }, [fetchRepos])

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  // channelId must be the "owner/repo" full name: every server consumer
  // (issue creation in github/hook.ts, webhook registration, and the ticket
  // link service's repo check) uses it in /repos/{owner}/{repo} API paths,
  // where a numeric repo id 404s.
  const handleRepoChange = (ownerRepo: string) => {
    setSelectedRepo(ownerRepo)
    updateMutation.mutate({ id: integrationId, config: { channelId: ownerRepo } })
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
          <p className="text-xs text-muted-foreground">
            Turn off to pause all GitHub issue syncing
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
          <Label htmlFor="repo-select">Repository</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchRepos}
            disabled={loadingRepos}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingRepos ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        {repoError ? (
          <p className="text-sm text-destructive">{repoError}</p>
        ) : (
          <Select
            value={selectedRepo}
            onValueChange={handleRepoChange}
            disabled={loadingRepos || saving || !integrationEnabled}
          >
            <SelectTrigger id="repo-select" className="w-full">
              {loadingRepos ? (
                <div className="flex items-center gap-2">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  <span>Loading repositories...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select a repository" />
              )}
            </SelectTrigger>
            <SelectContent>
              {repos.map((repo) => (
                <SelectItem key={repo.id} value={repo.fullName}>
                  <div className="flex items-center gap-2">
                    <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{repo.fullName}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          New feedback issues will be created in this repository.
        </p>
      </div>

      <div className="space-y-3">
        <Label className="text-base font-medium">Events</Label>
        <p className="text-xs text-muted-foreground">Choose which events trigger issue creation</p>
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

      <StatusSyncConfig
        integrationId={integrationId}
        integrationType="github"
        config={initialConfig}
        enabled={integrationEnabled}
        externalStatuses={[
          { id: 'Open', name: 'Open' },
          { id: 'Closed', name: 'Closed' },
        ]}
      />

      <TicketStatusSyncConfig
        integrationId={integrationId}
        config={initialConfig}
        enabled={integrationEnabled}
        externalStatuses={[
          { id: 'Open', name: 'Open' },
          { id: 'Closed', name: 'Closed' },
        ]}
      />

      <OnDeleteConfig
        integrationId={integrationId}
        integrationType="github"
        config={initialConfig}
        enabled={integrationEnabled}
      />
    </div>
  )
}
