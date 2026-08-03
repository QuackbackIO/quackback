'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import { fetchSyncLogFn } from '@/lib/server/functions/integrations'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/shared/utils'

interface GitHubSyncHistoryProps {
  integrationId: string
}

function useSyncLog(integrationId: string, statusFilter: 'all' | 'failed') {
  return useQuery(
    queryOptions({
      queryKey: ['integration-sync-log', integrationId, statusFilter] as const,
      queryFn: () => fetchSyncLogFn({ data: { integrationId, limit: 25, statusFilter } }),
      enabled: Boolean(integrationId),
      staleTime: 15_000,
      refetchInterval: 30_000,
    })
  )
}

function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = Date.now() - d.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function GitHubSyncHistory({ integrationId }: GitHubSyncHistoryProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'failed'>('all')
  const { data, error, isError, isLoading } = useSyncLog(integrationId, statusFilter)
  const items = data?.items ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-base font-medium">Sync History</Label>
          <p className="text-sm text-muted-foreground">Recent sync operations</p>
        </div>
        <div className="flex gap-1">
          <Button
            variant={statusFilter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setStatusFilter('all')}
          >
            All
          </Button>
          <Button
            variant={statusFilter === 'failed' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setStatusFilter('failed')}
          >
            Failed
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
      )}

      {isError && (
        <div className="text-sm text-destructive py-4 text-center" title={error.message}>
          Failed to load sync history
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="text-sm text-muted-foreground py-4 text-center">No sync activity yet</div>
      )}

      {items.length > 0 ? (
        <div className="divide-y divide-border/50 rounded-lg border text-sm">
          {items.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-3 py-2">
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] shrink-0',
                  entry.status === 'success' && 'border-green-500/30 text-green-600',
                  entry.status === 'failed' && 'border-red-500/30 text-red-600',
                  entry.status === 'skipped' && 'border-yellow-500/30 text-yellow-600'
                )}
              >
                {entry.status}
              </Badge>
              <span className="text-xs text-muted-foreground shrink-0">
                {entry.direction === 'outbound' ? '→' : '←'}
              </span>
              <span className="truncate min-w-0">
                {entry.eventType}
                {entry.ticketSubject && (
                  <span className="text-muted-foreground ml-1">· {entry.ticketSubject}</span>
                )}
              </span>
              {entry.errorMessage && (
                <span
                  className="text-xs text-destructive truncate max-w-[200px]"
                  title={entry.errorMessage}
                >
                  {entry.errorMessage}
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                {entry.durationMs != null && `${entry.durationMs}ms · `}
                {formatRelativeTime(entry.createdAt)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
