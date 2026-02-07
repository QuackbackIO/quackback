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
import {
  fetchJiraProjectsFn,
  fetchJiraIssueTypesFn,
  type JiraProject,
  type JiraIssueType,
} from '@/lib/server/integrations/jira/functions'

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
}

interface JiraConfigProps {
  integrationId: string
  initialConfig: { channelId?: string }
  initialEventMappings: EventMapping[]
  enabled: boolean
}

const EVENT_CONFIG = [
  {
    id: 'post.created' as const,
    label: 'Create issue from new feedback',
    description: 'Automatically create a Jira issue when new feedback is submitted',
  },
  {
    id: 'post.status_changed' as const,
    label: 'Sync status changes',
    description: 'Update linked issues when feedback status changes',
  },
]

function parseChannelId(channelId?: string): { projectId: string; issueTypeId: string } {
  if (!channelId || !channelId.includes(':')) {
    return { projectId: '', issueTypeId: '' }
  }
  const [projectId, issueTypeId] = channelId.split(':')
  return { projectId, issueTypeId }
}

export function JiraConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  enabled,
}: JiraConfigProps) {
  const updateMutation = useUpdateIntegration()

  const { projectId: initialProjectId, issueTypeId: initialIssueTypeId } = parseChannelId(
    initialConfig.channelId
  )

  const [projects, setProjects] = useState<JiraProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState(initialProjectId)

  const [issueTypes, setIssueTypes] = useState<JiraIssueType[]>([])
  const [loadingIssueTypes, setLoadingIssueTypes] = useState(false)
  const [issueTypeError, setIssueTypeError] = useState<string | null>(null)
  const [selectedIssueType, setSelectedIssueType] = useState(initialIssueTypeId)

  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)
  const [eventSettings, setEventSettings] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      EVENT_CONFIG.map((event) => [
        event.id,
        initialEventMappings.find((m) => m.eventType === event.id)?.enabled ?? false,
      ])
    )
  )

  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true)
    setProjectError(null)
    try {
      const result = await fetchJiraProjectsFn()
      setProjects(result)
    } catch {
      setProjectError('Failed to load projects. Please try again.')
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  const fetchIssueTypes = useCallback(async (projectId: string) => {
    setLoadingIssueTypes(true)
    setIssueTypeError(null)
    try {
      const result = await fetchJiraIssueTypesFn({ data: { projectId } })
      setIssueTypes(result.filter((t: JiraIssueType) => !t.subtask))
    } catch {
      setIssueTypeError('Failed to load issue types. Please try again.')
    } finally {
      setLoadingIssueTypes(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (selectedProject) {
      fetchIssueTypes(selectedProject)
    }
  }, [selectedProject, fetchIssueTypes])

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const handleProjectChange = (projectId: string) => {
    setSelectedProject(projectId)
    setSelectedIssueType('')
    setIssueTypes([])
  }

  const handleIssueTypeChange = (issueTypeId: string) => {
    setSelectedIssueType(issueTypeId)
    const channelId = `${selectedProject}:${issueTypeId}`
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
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Integration enabled
          </Label>
          <p className="text-sm text-muted-foreground">Turn off to pause all Jira issue syncing</p>
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
          <Label htmlFor="project-select">Project</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchProjects}
            disabled={loadingProjects}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingProjects ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        {projectError ? (
          <p className="text-sm text-destructive">{projectError}</p>
        ) : (
          <Select
            value={selectedProject}
            onValueChange={handleProjectChange}
            disabled={loadingProjects || saving || !integrationEnabled}
          >
            <SelectTrigger id="project-select" className="w-full">
              {loadingProjects ? (
                <div className="flex items-center gap-2">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  <span>Loading projects...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select a project" />
              )}
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  <div className="flex items-center gap-2">
                    <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>
                      {project.key} - {project.name}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          New feedback issues will be created in this project.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="issue-type-select">Issue type</Label>
        {issueTypeError ? (
          <p className="text-sm text-destructive">{issueTypeError}</p>
        ) : (
          <Select
            value={selectedIssueType}
            onValueChange={handleIssueTypeChange}
            disabled={!selectedProject || loadingIssueTypes || saving || !integrationEnabled}
          >
            <SelectTrigger id="issue-type-select" className="w-full">
              {loadingIssueTypes ? (
                <div className="flex items-center gap-2">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  <span>Loading issue types...</span>
                </div>
              ) : (
                <SelectValue
                  placeholder={selectedProject ? 'Select an issue type' : 'Select a project first'}
                />
              )}
            </SelectTrigger>
            <SelectContent>
              {issueTypes.map((issueType) => (
                <SelectItem key={issueType.id} value={issueType.id}>
                  {issueType.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          The issue type used when creating new issues from feedback.
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
