import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { updateTelemetryConfigFn } from '@/lib/server/functions/settings'

interface TelemetryToggleProps {
  initialEnabled: boolean
}

export function TelemetryToggle({ initialEnabled }: TelemetryToggleProps) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)

  async function handleToggle(checked: boolean): Promise<void> {
    setEnabled(checked)
    setSaving(true)
    try {
      await updateTelemetryConfigFn({ data: { enabled: checked } })
      await router.invalidate()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
        <div>
          <Label htmlFor="telemetry-toggle" className="text-sm font-medium cursor-pointer">
            Enable Anonymous Telemetry
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Help improve Quackback by sharing anonymous usage statistics
          </p>
        </div>
        <Switch
          id="telemetry-toggle"
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={saving}
          aria-label="Anonymous Telemetry"
        />
      </div>

      {saving && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}
    </div>
  )
}
