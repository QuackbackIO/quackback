import { useRouter } from '@tanstack/react-router'
import { useState, useTransition } from 'react'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { updateWidgetConfigFn } from '@/lib/server/functions/settings'

interface WidgetTicketingToggleProps {
  initialEnabled: boolean
  onEnabledChange?: (enabled: boolean) => void
}

export function WidgetTicketingToggle({
  initialEnabled,
  onEnabledChange,
}: WidgetTicketingToggleProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(initialEnabled)

  async function handleToggle(checked: boolean) {
    const previous = enabled
    setEnabled(checked)
    onEnabledChange?.(checked)
    setSaving(true)
    try {
      await updateWidgetConfigFn({ data: { ticketing: { enabled: checked } } })
      startTransition(() => router.invalidate())
    } catch {
      setEnabled(previous)
      onEnabledChange?.(previous)
    } finally {
      setSaving(false)
    }
  }

  const isBusy = saving || isPending

  return (
    <SettingsCard
      title="Support tickets"
      description="Let visitors open and follow up on support tickets from the widget."
    >
      <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
        <div className="pr-4">
          <Label htmlFor="widget-ticketing-toggle" className="text-sm font-medium cursor-pointer">
            Enable support tickets in the widget
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Visitors can open and follow up on support tickets from the widget. Disabling this hides
            ticket entry points and keeps widget ticket APIs unavailable.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InlineSpinner visible={isBusy} />
          <Switch
            id="widget-ticketing-toggle"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={isBusy}
            aria-label="Support tickets"
          />
        </div>
      </div>
    </SettingsCard>
  )
}
