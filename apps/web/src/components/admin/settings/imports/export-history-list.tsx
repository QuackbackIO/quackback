import { useQuery } from '@tanstack/react-query'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/shared/empty-state'
import { TimeAgo } from '@/components/ui/time-ago'
import { ArchiveBoxIcon } from '@heroicons/react/24/solid'

export interface ExportRunListItem {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  fileName: string
  sizeBytes: number | null
  entityCounts: Record<string, number> | null
  error: string | null
  createdAt: string
  finishedAt: string | null
  expiresAt: string | null
}

const IN_FLIGHT_STATUSES = new Set<ExportRunListItem['status']>(['pending', 'running'])

export async function fetchExportRuns(): Promise<ExportRunListItem[]> {
  const res = await fetch('/api/export/runs')
  if (!res.ok) throw new Error('Failed to load export history')
  const body = (await res.json()) as { runs: ExportRunListItem[] }
  return body.runs
}

const STATUS_LABEL: Record<ExportRunListItem['status'], string> = {
  pending: 'Queued',
  running: 'Exporting',
  completed: 'Completed',
  failed: 'Failed',
}

const STATUS_VARIANT: Record<
  ExportRunListItem['status'],
  'secondary' | 'default' | 'destructive' | 'outline'
> = {
  pending: 'secondary',
  running: 'default',
  completed: 'outline',
  failed: 'destructive',
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "1,204 posts · 86 companies · 5,632 votes +4 more" */
export function summarizeEntityCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  if (entries.length === 0) return '—'
  const shown = entries
    .slice(0, 3)
    .map(([key, count]) => `${count.toLocaleString()} ${key.replace(/_/g, ' ')}`)
  const rest = entries.length - shown.length
  return rest > 0 ? `${shown.join(' · ')} +${rest} more` : shown.join(' · ')
}

function isExpired(run: ExportRunListItem): boolean {
  return run.expiresAt != null && new Date(run.expiresAt).getTime() < Date.now()
}

export function ExportHistoryList() {
  const { data: runs, isLoading } = useQuery({
    queryKey: ['export-runs'],
    queryFn: fetchExportRuns,
    refetchInterval: (query) => {
      const rows = query.state.data
      return rows?.some((r) => IN_FLIGHT_STATUSES.has(r.status)) ? 2000 : false
    },
  })

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading export history...</p>
  }

  if (!runs || runs.length === 0) {
    return (
      <EmptyState
        icon={ArchiveBoxIcon}
        title="No exports yet"
        description="Workspace exports you start above show up here with a download link."
        className="py-8"
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Contents</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Download</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="text-sm text-muted-foreground">
                <TimeAgo date={run.createdAt} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {run.sizeBytes != null ? formatBytes(run.sizeBytes) : '—'}
              </TableCell>
              <TableCell
                className="max-w-[260px] truncate text-sm text-muted-foreground"
                title={
                  run.error ?? (run.entityCounts ? summarizeEntityCounts(run.entityCounts) : '')
                }
              >
                {run.status === 'failed'
                  ? (run.error ?? 'Export failed')
                  : run.entityCounts
                    ? summarizeEntityCounts(run.entityCounts)
                    : '—'}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[run.status]}>{STATUS_LABEL[run.status]}</Badge>
              </TableCell>
              <TableCell className="text-right">
                {run.status === 'completed' && !isExpired(run) ? (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`/api/export/runs/${run.id}/download`}>
                      <ArrowDownTrayIcon className="size-4" />
                      ZIP
                    </a>
                  </Button>
                ) : run.status === 'completed' && isExpired(run) ? (
                  <span className="text-sm text-muted-foreground">Expired</span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
