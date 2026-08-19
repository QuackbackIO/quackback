'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ticketQueries } from '@/lib/client/queries/inbox'
import { useUpdateTicketStatusMappings } from '@/lib/client/mutations'
import type { ExternalStatus } from './status-sync-config'

interface TicketStatusSyncConfigProps {
  integrationId: string
  config: Record<string, unknown>
  enabled: boolean
  /** External statuses from the platform (e.g., GitHub issue Open/Closed) */
  externalStatuses: ExternalStatus[]
}

const IGNORE_VALUE = '__ignore__'

/**
 * Ticket-side sibling of StatusSyncConfig's mapping table: maps the same
 * inbound external statuses onto ticket statuses (config.ticketStatusMappings)
 * for tickets manually linked to issues. Rides the same inbound webhook as
 * the post mapping, so it only shows once status sync is enabled.
 */
export function TicketStatusSyncConfig({
  integrationId,
  config,
  enabled,
  externalStatuses,
}: TicketStatusSyncConfigProps) {
  const statusSyncEnabled = (config.statusSyncEnabled as boolean) ?? false
  const existingMappings = (config.ticketStatusMappings ?? {}) as Record<string, string | null>

  const [mappings, setMappings] = useState<Record<string, string | null>>(existingMappings)

  const statusesQuery = useQuery(ticketQueries.statuses())
  const ticketStatuses = statusesQuery.data ?? []

  const updateMappings = useUpdateTicketStatusMappings()
  const saving = updateMappings.isPending

  if (!statusSyncEnabled || externalStatuses.length === 0) return null

  const handleMappingChange = (externalStatusName: string, ticketStatusId: string) => {
    const value = ticketStatusId === IGNORE_VALUE ? null : ticketStatusId
    const newMappings = { ...mappings, [externalStatusName]: value }
    setMappings(newMappings)
    updateMappings.mutate({ integrationId, ticketStatusMappings: newMappings })
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-base font-medium">Ticket status mapping</Label>
        <p className="text-xs text-muted-foreground">
          Map issue states to ticket statuses for tickets linked to issues. Unmapped states are
          ignored.
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
              disabled={saving || !enabled || statusesQuery.isPending}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={IGNORE_VALUE}>
                  <span className="text-muted-foreground">Ignore</span>
                </SelectItem>
                {ticketStatuses.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    {status.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      {saving && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      {updateMappings.isError && (
        <div className="text-sm text-destructive">
          {updateMappings.error?.message || 'Failed to save changes'}
        </div>
      )}
    </div>
  )
}
