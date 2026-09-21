import { Label } from '@/components/ui/label'
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
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={`context-${integrationId}`} className="text-base font-medium">
            Customer context
          </Label>
          <p className="text-xs text-muted-foreground">
            Look up customer details by email when you open customer context.
          </p>
        </div>
        <Switch
          id={`context-${integrationId}`}
          checked={enabled}
          disabled={update.isPending}
          onCheckedChange={(checked) => update.mutate({ id: integrationId, enabled: checked })}
        />
      </div>
      {update.isError && (
        <p role="alert" className="text-sm text-destructive">
          {update.error.message || 'Failed to save changes'}
        </p>
      )}
    </div>
  )
}
