/**
 * Per-tool execution controls: whether the assistant may use a tool
 * autonomously, only with a teammate's approval, or not at all. One row per
 * tool from the resolved catalogue (built-ins plus enabled connectors); the
 * mode select is limited to that tool's supported modes, seeded from the
 * saved control or the tool's own default when nothing is saved yet.
 */
import { useState, useTransition } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantToolControls } from '@/lib/client/mutations/assistant'
import type { AssistantToolSummary } from '@/lib/server/functions/assistant-guidance'

type ToolControlMode = AssistantToolSummary['defaultMode']

const MODE_LABELS: Record<ToolControlMode, string> = {
  disabled: 'Disabled',
  approval: 'Ask for approval',
  autonomous: 'Autonomous',
}

const RISK_LABELS: Record<AssistantToolSummary['risk'], string> = {
  read: 'Read',
  write: 'Write',
}

export function ToolControlsCard() {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const toolsQuery = useQuery(assistantQueries.tools())
  const settingsQuery = useQuery(assistantQueries.settings())
  const updateToolControls = useUpdateAssistantToolControls()
  // Instant feedback while a save is in flight; cleared on failure so the
  // select falls back to the last-saved value, and superseded by fresh query
  // data once the mutation's invalidate lands.
  const [overrides, setOverrides] = useState<Record<string, ToolControlMode>>({})
  const [savingTool, setSavingTool] = useState<string | null>(null)

  const tools = toolsQuery.data ?? []
  const savedControls = settingsQuery.data?.toolControls ?? {}

  async function handleModeChange(tool: AssistantToolSummary, mode: ToolControlMode) {
    const merged = { ...savedControls, ...overrides, [tool.name]: mode }
    setOverrides((prev) => ({ ...prev, [tool.name]: mode }))
    setSavingTool(tool.name)
    try {
      await updateToolControls.mutateAsync(merged)
      startTransition(() => router.invalidate())
    } catch {
      setOverrides((prev) => {
        const next = { ...prev }
        delete next[tool.name]
        return next
      })
    } finally {
      setSavingTool(null)
    }
  }

  return (
    <SettingsCard
      title="Tool controls"
      description="Choose how the assistant may use each tool: fully autonomous, only with a teammate's approval, or not at all."
    >
      <div className="space-y-2">
        {tools.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No tools available.</p>
        )}
        {tools.map((tool) => {
          const mode = overrides[tool.name] ?? savedControls[tool.name] ?? tool.defaultMode
          return (
            <div
              key={tool.name}
              className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{tool.label}</p>
                  <Badge
                    variant={tool.risk === 'write' ? 'default' : 'secondary'}
                    className="shrink-0"
                  >
                    {RISK_LABELS[tool.risk]}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{tool.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <InlineSpinner visible={savingTool === tool.name} />
                <Select
                  value={mode}
                  onValueChange={(value) => handleModeChange(tool, value as ToolControlMode)}
                  disabled={savingTool === tool.name}
                >
                  <SelectTrigger size="sm" className="w-44" aria-label={`${tool.label} mode`}>
                    <SelectValue>{MODE_LABELS[mode]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {tool.supportedModes.map((supportedMode) => (
                      <SelectItem key={supportedMode} value={supportedMode}>
                        {MODE_LABELS[supportedMode]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )
        })}
      </div>
    </SettingsCard>
  )
}
