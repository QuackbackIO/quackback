'use client'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useUpdateIntegration } from '@/lib/client/mutations'
import { getIntegrationActionVerb, getIntegrationDisplayName } from '@/lib/shared/integrations'

interface OnDeleteConfigProps {
  integrationId: string
  integrationType: string
  config: Record<string, unknown>
  enabled: boolean
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

  const action = getIntegrationActionVerb(integrationType)
  const name = getIntegrationDisplayName(integrationType)

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
