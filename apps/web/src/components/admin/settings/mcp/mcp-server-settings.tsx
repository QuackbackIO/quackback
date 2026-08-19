import { useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { updateDeveloperConfigFn } from '@/lib/server/functions/settings'

interface McpServerSettingsProps {
  initialEnabled: boolean
  initialDynamicRegistrationEnabled: boolean
}

interface ToggleRowProps {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  busy: boolean
  onCheckedChange: (checked: boolean) => void
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  busy,
  onCheckedChange,
}: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
      <div>
        <Label htmlFor={id} className="text-sm font-medium cursor-pointer">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {busy && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-label={label}
        />
      </div>
    </div>
  )
}

export function McpServerSettings({
  initialEnabled,
  initialDynamicRegistrationEnabled,
}: McpServerSettingsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [dynamicRegistration, setDynamicRegistration] = useState(initialDynamicRegistrationEnabled)

  const save = async (data: {
    mcpEnabled?: boolean
    oauthDynamicClientRegistrationEnabled?: boolean
  }) => {
    setSaving(true)
    try {
      await updateDeveloperConfigFn({ data })
      startTransition(() => {
        router.invalidate()
      })
    } finally {
      setSaving(false)
    }
  }

  const isBusy = saving || isPending

  return (
    <div className="space-y-3">
      <ToggleRow
        id="mcp-toggle"
        label="Enable MCP Server"
        description="Allow AI tools like Claude Code to interact with your feedback data via the MCP protocol"
        checked={enabled}
        disabled={isBusy}
        busy={isBusy}
        onCheckedChange={(c) => {
          setEnabled(c)
          void save({ mcpEnabled: c })
        }}
      />
      <ToggleRow
        id="dynamic-registration-toggle"
        label="Dynamic client registration"
        description="Let new OAuth apps (like MCP clients) register themselves. Turning this off blocks new apps; already-connected apps keep working"
        checked={dynamicRegistration}
        disabled={isBusy}
        busy={isBusy}
        onCheckedChange={(c) => {
          setDynamicRegistration(c)
          void save({ oauthDynamicClientRegistrationEnabled: c })
        }}
      />
    </div>
  )
}
