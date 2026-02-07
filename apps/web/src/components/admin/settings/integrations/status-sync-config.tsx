'use client'

import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowPathIcon, ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  useEnableStatusSync,
  useDisableStatusSync,
  useUpdateStatusMappings,
} from '@/lib/client/mutations'

/** External statuses that can be mapped (provided by the integration config component) */
export interface ExternalStatus {
  id: string
  name: string
}

interface StatusSyncConfigProps {
  integrationId: string
  integrationType: string
  config: Record<string, unknown>
  enabled: boolean
  /** External statuses from the platform (e.g., Linear workflow states) */
  externalStatuses: ExternalStatus[]
  /** Whether this platform requires manual webhook setup (vs auto-registration) */
  isManual?: boolean
}

const IGNORE_VALUE = '__ignore__'

export function StatusSyncConfig({
  integrationId,
  integrationType,
  config,
  enabled,
  externalStatuses,
  isManual = false,
}: StatusSyncConfigProps) {
  const statusSyncEnabled = (config.statusSyncEnabled as boolean) ?? false
  const existingMappings = (config.statusMappings ?? {}) as Record<string, string | null>
  const webhookSecret = config.webhookSecret as string | undefined

  const [mappings, setMappings] = useState<Record<string, string | null>>(existingMappings)
  const [copied, setCopied] = useState(false)

  const statusesQuery = useSuspenseQuery(adminQueries.statuses())
  const quackbackStatuses = statusesQuery.data

  const enableSync = useEnableStatusSync()
  const disableSync = useDisableStatusSync()
  const updateMappings = useUpdateStatusMappings()

  const saving = enableSync.isPending || disableSync.isPending || updateMappings.isPending

  const handleSyncToggle = (checked: boolean) => {
    if (checked) {
      enableSync.mutate({ integrationId, integrationType })
    } else {
      disableSync.mutate({ integrationId, integrationType })
    }
  }

  const handleMappingChange = (externalStatusName: string, quackbackStatusId: string) => {
    const value = quackbackStatusId === IGNORE_VALUE ? null : quackbackStatusId
    const newMappings = { ...mappings, [externalStatusName]: value }
    setMappings(newMappings)
    updateMappings.mutate({ integrationId, statusMappings: newMappings })
  }

  const webhookUrl = webhookSecret
    ? `${window.location.origin}/api/integrations/${integrationType}/webhook`
    : null

  const handleCopyUrl = () => {
    if (webhookUrl) {
      navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="space-y-6 border-t border-border/50 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="status-sync-toggle" className="text-base font-medium">
            Status sync
          </Label>
          <p className="text-sm text-muted-foreground">
            Automatically update post statuses when issues change in{' '}
            {integrationType.charAt(0).toUpperCase() + integrationType.slice(1).replace('_', ' ')}
          </p>
        </div>
        <Switch
          id="status-sync-toggle"
          checked={statusSyncEnabled}
          onCheckedChange={handleSyncToggle}
          disabled={saving || !enabled}
        />
      </div>

      {statusSyncEnabled && isManual && webhookUrl && (
        <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-2">
          <p className="text-sm font-medium">Webhook URL</p>
          <p className="text-xs text-muted-foreground">
            Copy this URL into your {integrationType.replace('_', ' ')} webhook settings.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono break-all">
              {webhookUrl}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopyUrl} className="shrink-0">
              {copied ? (
                <CheckIcon className="h-4 w-4" />
              ) : (
                <ClipboardDocumentIcon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {statusSyncEnabled && externalStatuses.length > 0 && (
        <div className="space-y-3">
          <div>
            <Label className="text-base font-medium">Status mapping</Label>
            <p className="text-sm text-muted-foreground">
              Map external statuses to Quackback statuses. Unmapped statuses are ignored.
            </p>
          </div>

          <div className="space-y-2">
            {externalStatuses.map((ext) => (
              <div
                key={ext.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3"
              >
                <span className="text-sm font-medium min-w-0 truncate">{ext.name}</span>
                <Select
                  value={mappings[ext.name] ?? IGNORE_VALUE}
                  onValueChange={(value) => handleMappingChange(ext.name, value)}
                  disabled={saving || !enabled}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={IGNORE_VALUE}>
                      <span className="text-muted-foreground">Ignore</span>
                    </SelectItem>
                    {quackbackStatuses.map((status) => (
                      <SelectItem key={status.id} value={status.id}>
                        {status.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      {saving && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      {(enableSync.isError || disableSync.isError || updateMappings.isError) && (
        <div className="text-sm text-destructive">
          {enableSync.error?.message ||
            disableSync.error?.message ||
            updateMappings.error?.message ||
            'Failed to save changes'}
        </div>
      )}
    </div>
  )
}
