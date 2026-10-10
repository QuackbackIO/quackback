import { SettingRow } from '@/components/admin/settings/setting-row'
import { Switch } from '@/components/ui/switch'
import { useUpdateIntegration } from '@/lib/client/mutations'

export function CustomerContextConfig({
  integrationId,
  enabled,
}: {
  integrationId: string
  enabled: boolean
}) {
  const update = useUpdateIntegration()
  return (
    <div className="space-y-3">
      <SettingRow
        label="Customer context"
        htmlFor={`context-${integrationId}`}
        description="Look up customer details by email when you open customer context."
        control={
          <Switch
            id={`context-${integrationId}`}
            checked={enabled}
            disabled={update.isPending}
            onCheckedChange={(checked) => update.mutate({ id: integrationId, enabled: checked })}
          />
        }
      />
      {update.isError && (
        <p role="alert" className="text-sm text-destructive">
          {update.error.message || 'Failed to save changes'}
        </p>
      )}
    </div>
  )
}
