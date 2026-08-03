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
import { OnDeleteConfig } from '@/components/admin/settings/integrations/on-delete-config'
import { useInboxes } from '@/lib/client/hooks/use-inboxes-queries'
import { GitHubUserMappings } from './github-user-mappings'
import { GitHubSyncHistory } from './github-sync-history'
import { GitHubReconnectButton } from './github-connection-actions'
import type { GitHubSyncDirection } from '@/lib/server/integrations/github/types'
import type { UpdateIntegrationInput } from '@/lib/server/functions/integrations'

type StoredEventMappingFilters = Record<string, unknown>
type EventMappingUpdate = NonNullable<UpdateIntegrationInput['eventMappings']>[number]
type EventMappingUpdateFilters = EventMappingUpdate['filters']

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
  filters?: StoredEventMappingFilters | null
}

interface GitHubConfigProps {
  integrationId: string
  initialConfig: Record<string, unknown>
  initialEventMappings: EventMapping[]
  enabled: boolean
}

const SYNC_DIRECTIONS: { value: GitHubSyncDirection; label: string; description: string }[] = [
  { value: 'outbound', label: 'Outbound', description: 'Ticket changes → GitHub issues' },
  { value: 'inbound', label: 'Inbound', description: 'GitHub issues → Tickets' },
  { value: 'bidirectional', label: 'Bidirectional', description: 'Sync both ways' },
]

const TICKET_EVENTS = [
  {
    id: 'ticket.created',
    label: 'Ticket created → Create issue',
    description: 'Create a GitHub issue when a ticket is created',
  },
  {
    id: 'ticket.status_changed',
    label: 'Ticket status changed → Update issue',
    description: 'Open/close GitHub issue when ticket status changes',
  },
  {
    id: 'ticket.assigned',
    label: 'Ticket assigned → Assign issue',
    description: 'Sync ticket assignee to GitHub issue',
  },
  {
    id: 'ticket.updated',
    label: 'Ticket updated → Update issue',
    description: 'Sync ticket subject/description changes to GitHub issue',
  },
  {
    id: 'ticket.thread_added',
    label: 'Public reply added → Comment on issue',
    description: 'Sync new public ticket replies to GitHub issue comments',
  },
  {
    id: 'ticket.thread_updated',
    label: 'Public reply edited → Edit issue comment',
    description: 'Sync edits to public ticket replies back to GitHub',
  },
  {
    id: 'ticket.thread_deleted',
    label: 'Public reply deleted → Delete issue comment',
    description: 'Delete the linked GitHub issue comment when a public reply is deleted',
  },
  {
    id: 'ticket.attachment_added',
    label: 'Attachment added → Comment on issue',
    description: 'Sync ticket attachment additions to GitHub issue comments',
  },
  {
    id: 'ticket.attachment_removed',
    label: 'Attachment removed → Comment on issue',
    description: 'Sync ticket attachment removals to GitHub issue comments',
  },
]

const POST_EVENTS = [
  {
    id: 'post.created',
    label: 'Create issue from new feedback',
    description: 'Create a GitHub issue when new feedback is submitted',
  },
  {
    id: 'post.status_changed',
    label: 'Sync feedback status changes',
    description: 'Update linked issues when feedback status changes',
  },
]

const ALL_INBOXES_VALUE = '__all_inboxes__'
const TICKET_EVENT_IDS = new Set(TICKET_EVENTS.map((event) => event.id))
const TICKET_THREAD_EVENT_IDS = new Set([
  'ticket.thread_added',
  'ticket.thread_updated',
  'ticket.thread_deleted',
])

function normalizeEventMappingFilters(
  filters: StoredEventMappingFilters | null | undefined
): EventMappingUpdateFilters {
  if (!filters) return null

  const normalized: NonNullable<EventMappingUpdateFilters> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = value
      continue
    }
    if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) {
      normalized[key] = value
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

export function GitHubConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  enabled,
}: GitHubConfigProps) {
  const updateMutation = useUpdateIntegration()
  const inboxesQuery = useInboxes({ includeArchived: false })
  const inboxes = inboxesQuery.data ?? []

  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)

  const [selectedRepo, setSelectedRepo] = useState((initialConfig.channelId as string) || '')
  const [_label, _setLabel] = useState((initialConfig.label as string) || '')
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)
  const initialSyncDirection = (initialConfig.syncDirection as GitHubSyncDirection) || 'outbound'
  const [syncDirection, setSyncDirection] = useState<GitHubSyncDirection>(initialSyncDirection)
  const [assigneeSync, setAssigneeSync] = useState((initialConfig.assigneeSync as boolean) ?? false)
  const [createTicketsFromIssues, setCreateTicketsFromIssues] = useState(
    (initialConfig.createTicketsFromIssues as boolean) ?? false
  )
  const [defaultInboxId, setDefaultInboxId] = useState(
    (initialConfig.defaultInboxId as string) || ''
  )
  const [eventFilters] = useState<Record<string, StoredEventMappingFilters | null>>(() =>
    Object.fromEntries(
      initialEventMappings.map((mapping) => [mapping.eventType, mapping.filters ?? null])
    )
  )
  const [eventSettings, setEventSettings] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      [...TICKET_EVENTS, ...POST_EVENTS].map((event) => {
        const explicit = initialEventMappings.find((m) => m.eventType === event.id)
        const hasTicketSync = initialEventMappings.some(
          (m) =>
            TICKET_EVENT_IDS.has(m.eventType) &&
            !TICKET_THREAD_EVENT_IDS.has(m.eventType) &&
            m.enabled
        )
        const defaultThreadSync =
          TICKET_THREAD_EVENT_IDS.has(event.id) &&
          (initialSyncDirection === 'outbound' || initialSyncDirection === 'bidirectional') &&
          hasTicketSync
        return [event.id, explicit?.enabled ?? defaultThreadSync]
      })
    )
  )

  const isInbound = syncDirection === 'inbound' || syncDirection === 'bidirectional'
  const isOutbound = syncDirection === 'outbound' || syncDirection === 'bidirectional'
  const showInboxSelector = isOutbound || (isInbound && createTicketsFromIssues)
  const inboxSelectValue = defaultInboxId || ALL_INBOXES_VALUE
  const inboxAllLabel =
    isOutbound && isInbound
      ? 'All inboxes / no default'
      : isOutbound
        ? 'All inboxes'
        : 'No default inbox'
  const inboxHelpText = isOutbound
    ? isInbound
      ? 'Only tickets from this inbox sync to GitHub. New tickets from GitHub issues are created here when enabled.'
      : 'Only tickets from this inbox sync to this GitHub repository. Choose All inboxes to sync every ticket.'
    : 'New tickets from GitHub issues will be created in this inbox.'

  const getTicketFilters = (
    inboxId: string,
    direction: GitHubSyncDirection
  ): EventMappingUpdateFilters => {
    const outbound = direction === 'outbound' || direction === 'bidirectional'
    return outbound && inboxId ? { inboxIds: [inboxId] } : null
  }

  const buildEventMappingUpdates = (
    settings: Record<string, boolean>,
    inboxId: string,
    direction: GitHubSyncDirection
  ): NonNullable<UpdateIntegrationInput['eventMappings']> => {
    const ticketFilters = getTicketFilters(inboxId, direction)
    return Object.entries(settings).map(([eventType, enabled]) => ({
      eventType,
      enabled,
      filters: TICKET_EVENT_IDS.has(eventType)
        ? ticketFilters
        : normalizeEventMappingFilters(eventFilters[eventType]),
    }))
  }

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true)
    setRepoError(null)
    try {
      const result = await fetchGitHubReposFn({ data: { integrationId } })
      setRepos(result)
      if (selectedRepo && !result.some((repo) => repo.fullName === selectedRepo)) {
        setRepoError(
          'The configured repository is no longer visible to this GitHub authorization. Reconnect GitHub or choose another repository.'
        )
      }
    } catch (err) {
      setRepoError(
        err instanceof Error
          ? err.message
          : 'Failed to load GitHub repositories. Reconnect GitHub and try again.'
      )
    } finally {
      setLoadingRepos(false)
    }
  }, [integrationId, selectedRepo])

  useEffect(() => {
    fetchRepos()
  }, [fetchRepos])

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const handleRepoChange = (repoFullName: string) => {
    setSelectedRepo(repoFullName)
    updateMutation.mutate({ id: integrationId, config: { channelId: repoFullName } })
  }

  const handleSyncDirectionChange = (value: GitHubSyncDirection) => {
    setSyncDirection(value)
    updateMutation.mutate({
      id: integrationId,
      config: { syncDirection: value },
      eventMappings: buildEventMappingUpdates(eventSettings, defaultInboxId, value),
    })
  }

  const handleAssigneeSyncChange = (checked: boolean) => {
    setAssigneeSync(checked)
    updateMutation.mutate({ id: integrationId, config: { assigneeSync: checked } })
  }

  const handleCreateTicketsChange = (checked: boolean) => {
    setCreateTicketsFromIssues(checked)
    updateMutation.mutate({ id: integrationId, config: { createTicketsFromIssues: checked } })
  }

  const handleDefaultInboxChange = (value: string) => {
    const nextInboxId = value === ALL_INBOXES_VALUE ? '' : value
    setDefaultInboxId(nextInboxId)
    updateMutation.mutate({
      id: integrationId,
      config: { defaultInboxId: nextInboxId || null },
      eventMappings: buildEventMappingUpdates(eventSettings, nextInboxId, syncDirection),
    })
  }

  const handleEventToggle = (eventId: string, checked: boolean) => {
    const newSettings = { ...eventSettings, [eventId]: checked }
    setEventSettings(newSettings)
    updateMutation.mutate({
      id: integrationId,
      eventMappings: buildEventMappingUpdates(newSettings, defaultInboxId, syncDirection),
    })
  }

  const saving = updateMutation.isPending

  return (
    <div className="space-y-6">
      {/* Enable/disable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor={`enabled-toggle-${integrationId}`} className="text-base font-medium">
            Integration enabled
          </Label>
          <p className="text-sm text-muted-foreground">
            Turn off to pause all syncing for this repository
          </p>
        </div>
        <Switch
          id={`enabled-toggle-${integrationId}`}
          checked={integrationEnabled}
          onCheckedChange={handleEnabledChange}
          disabled={saving}
        />
      </div>

      {/* Repository selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Repository</Label>
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
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
            <p>{repoError}</p>
            <GitHubReconnectButton
              integrationId={integrationId}
              label="Reconnect GitHub"
              className="self-start sm:self-auto"
            />
          </div>
        ) : (
          <Select
            value={selectedRepo}
            onValueChange={handleRepoChange}
            disabled={loadingRepos || saving || !integrationEnabled}
          >
            <SelectTrigger className="w-full">
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
      </div>

      {/* Sync direction */}
      <div className="space-y-2">
        <Label>Sync direction</Label>
        <Select
          value={syncDirection}
          onValueChange={handleSyncDirectionChange}
          disabled={saving || !integrationEnabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SYNC_DIRECTIONS.map((dir) => (
              <SelectItem key={dir.value} value={dir.value}>
                <div>
                  <span className="font-medium">{dir.label}</span>
                  <span className="ml-2 text-muted-foreground text-xs">{dir.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Assignee sync */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Assignee sync</Label>
          <p className="text-xs text-muted-foreground">
            Sync ticket assignees to/from GitHub issue assignees
          </p>
        </div>
        <Switch
          checked={assigneeSync}
          onCheckedChange={handleAssigneeSyncChange}
          disabled={saving || !integrationEnabled}
        />
      </div>

      {/* Inbound settings */}
      {isInbound && (
        <div className="space-y-4 rounded-lg border border-border/50 p-4">
          <div>
            <Label className="text-sm font-medium">Inbound settings</Label>
            <p className="text-xs text-muted-foreground">
              Configure how GitHub issues create tickets
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Create tickets from new issues</Label>
              <p className="text-xs text-muted-foreground">
                Automatically create a ticket when a new issue is opened in this repository
              </p>
            </div>
            <Switch
              checked={createTicketsFromIssues}
              onCheckedChange={handleCreateTicketsChange}
              disabled={saving || !integrationEnabled}
            />
          </div>
        </div>
      )}

      {showInboxSelector && (
        <div className="space-y-2">
          <Label className="text-sm">Inbox</Label>
          <Select
            value={inboxSelectValue}
            onValueChange={handleDefaultInboxChange}
            disabled={saving || !integrationEnabled || inboxesQuery.isLoading}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select an inbox" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_INBOXES_VALUE}>{inboxAllLabel}</SelectItem>
              {inboxes.map((inbox) => (
                <SelectItem key={inbox.id} value={inbox.id}>
                  {inbox.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{inboxHelpText}</p>
        </div>
      )}

      {/* Outbound ticket events */}
      {isOutbound && (
        <div className="space-y-3">
          <div>
            <Label className="text-base font-medium">Ticket events</Label>
            <p className="text-sm text-muted-foreground">
              Choose which ticket events sync to GitHub issues
            </p>
          </div>
          <div className="space-y-3 pt-1">
            {TICKET_EVENTS.map((event) => (
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
      )}

      {/* Post/feedback events */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-medium">Feedback events</Label>
          <p className="text-sm text-muted-foreground">Legacy feedback-to-issue syncing (posts)</p>
        </div>
        <div className="space-y-3 pt-1">
          {POST_EVENTS.map((event) => (
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

      {/* User mappings */}
      {assigneeSync && (
        <GitHubUserMappings integrationId={integrationId} disabled={!integrationEnabled} />
      )}

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

      <OnDeleteConfig
        integrationId={integrationId}
        integrationType="github"
        config={initialConfig}
        enabled={integrationEnabled}
      />

      <GitHubSyncHistory integrationId={integrationId} />
    </div>
  )
}
