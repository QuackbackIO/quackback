import { useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { updateDeveloperConfigFn } from '@/lib/server/functions/settings'

interface McpServerSettingsProps {
  initialEnabled: boolean
}

export function McpServerSettings({ initialEnabled }: McpServerSettingsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(initialEnabled)

  const handleToggle = async (checked: boolean) => {
    setEnabled(checked)
    setSaving(true)
    try {
      await updateDeveloperConfigFn({ data: { mcpEnabled: checked } })
      startTransition(() => {
        router.invalidate()
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
        <div>
          <Label htmlFor="mcp-toggle" className="text-sm font-medium cursor-pointer">
            Enable MCP Server
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Allow AI tools like Claude Code to interact with your feedback data via the MCP protocol
          </p>
        </div>
        <Switch
          id="mcp-toggle"
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={saving || isPending}
          aria-label="MCP Server"
        />
      </div>

      {(saving || isPending) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}
    </div>
  )
}
