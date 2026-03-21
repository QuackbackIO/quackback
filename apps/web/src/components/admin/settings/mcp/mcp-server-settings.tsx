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

  const isBusy = saving || isPending

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
        <div className="flex items-center gap-2">
          {isBusy && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Switch
            id="mcp-toggle"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={isBusy}
            aria-label="MCP Server"
          />
        </div>
      </div>
    </div>
  )
}
