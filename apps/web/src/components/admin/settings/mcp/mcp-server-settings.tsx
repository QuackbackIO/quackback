import { useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { Switch } from '@/components/ui/switch'
import { UpgradeModal } from '@/components/admin/upgrade'
import { updateDeveloperConfigFn } from '@/lib/server/functions/settings'
import { isPlanRefusal } from '@/lib/shared/describe-upgrade'

interface McpServerSettingsProps {
  entitled: boolean
  initialEnabled: boolean
  initialDynamicRegistrationEnabled: boolean
}

function BusySwitch({
  id,
  label,
  checked,
  disabled,
  busy,
  onCheckedChange,
}: {
  id: string
  label: string
  checked: boolean
  disabled: boolean
  busy: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <>
      {busy && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
      />
    </>
  )
}

export function McpServerSettings({
  entitled,
  initialEnabled,
  initialDynamicRegistrationEnabled,
}: McpServerSettingsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
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
    } catch (error) {
      if (data.mcpEnabled === true && isPlanRefusal(error)) {
        setEnabled(false)
        setUpgradeOpen(true)
        return
      }
      throw error
    } finally {
      setSaving(false)
    }
  }

  const isBusy = saving || isPending

  return (
    <>
      <SettingRows>
        <SettingRow
          label="MCP server"
          htmlFor="mcp-toggle"
          description="Let AI coding tools work with your feedback over MCP."
          control={
            <BusySwitch
              id="mcp-toggle"
              label="MCP server"
              checked={enabled}
              disabled={isBusy}
              busy={isBusy}
              onCheckedChange={(c) => {
                if (c && !entitled) {
                  setUpgradeOpen(true)
                  return
                }
                setEnabled(c)
                void save({ mcpEnabled: c })
              }}
            />
          }
        />
        <SettingRow
          label="Dynamic client registration"
          htmlFor="dynamic-registration-toggle"
          description="Let new OAuth apps register themselves. Already-connected apps keep working when this is off."
          control={
            <BusySwitch
              id="dynamic-registration-toggle"
              label="Dynamic client registration"
              checked={dynamicRegistration}
              disabled={isBusy}
              busy={isBusy}
              onCheckedChange={(c) => {
                setDynamicRegistration(c)
                void save({ oauthDynamicClientRegistrationEnabled: c })
              }}
            />
          }
        />
      </SettingRows>
      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} entitlement="mcpServer" />
    </>
  )
}
