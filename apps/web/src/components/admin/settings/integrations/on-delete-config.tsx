'use client'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useUpdateIntegration } from '@/lib/client/mutations'

interface OnDeleteConfigProps {
  integrationId: string
  integrationType: string
  config: Record<string, unknown>
  enabled: boolean
}

/** Get the action verb for a platform (Close vs Archive) */
function getActionVerb(integrationType: string): string {
  switch (integrationType) {
    case 'github':
    case 'jira':
    case 'gitlab':
    case 'clickup':
    case 'azure_devops':
      return 'Close'
    default:
      return 'Archive'
  }
}

function getDisplayName(integrationType: string): string {
  const names: Record<string, string> = {
    linear: 'Linear',
    github: 'GitHub',
    jira: 'Jira',
    gitlab: 'GitLab',
    clickup: 'ClickUp',
    asana: 'Asana',
    shortcut: 'Shortcut',
    azure_devops: 'Azure DevOps',
    trello: 'Trello',
    notion: 'Notion',
    monday: 'Monday',
  }
  return names[integrationType] ?? integrationType
}

export function OnDeleteConfig({
  integrationId,
  integrationType,
  config,
  enabled,
}: OnDeleteConfigProps) {
  const updateMutation = useUpdateIntegration()
  const onDeleteAction = (config.onDeleteAction as string) ?? 'nothing'
  const isChecked = onDeleteAction === 'archive'
  const saving = updateMutation.isPending

  const action = getActionVerb(integrationType)
  const name = getDisplayName(integrationType)

  const handleToggle = (checked: boolean) => {
    updateMutation.mutate({
      id: integrationId,
      config: { onDeleteAction: checked ? 'archive' : 'nothing' },
    })
  }

  return (
    <div className="space-y-2 border-t border-border/50 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="on-delete-toggle" className="text-base font-medium">
            On post delete
          </Label>
          <p className="text-sm text-muted-foreground">
            {action} linked issues when a post is deleted
          </p>
        </div>
        <Switch
          id="on-delete-toggle"
          checked={isChecked}
          onCheckedChange={handleToggle}
          disabled={saving || !enabled}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        When enabled, the delete confirmation dialog will pre-check the option to{' '}
        {action.toLowerCase()} linked {name} issues.
      </p>
    </div>
  )
}
