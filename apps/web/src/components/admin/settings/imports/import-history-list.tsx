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

export interface ImportRunErrorEntry {
  row: number
  message: string
  field?: string
}

export interface ImportRunTotals {
  rows: number
  created: number
  updated: number
  skipped: number
  errors: number
}

export interface ImportRunListItem {
  id: string
  source: 'csv' | 'uservoice' | 'canny' | 'api'
  fileName: string
  status: 'pending' | 'dry_run' | 'running' | 'completed' | 'failed'
  totals: ImportRunTotals | null
  errorReport: ImportRunErrorEntry[] | null
  createdAt: string
  finishedAt: string | null
}

const IN_FLIGHT_STATUSES = new Set(['pending', 'dry_run', 'running'])

async function fetchImportRuns(): Promise<ImportRunListItem[]> {
  const res = await fetch('/api/import/runs')
  if (!res.ok) throw new Error('Failed to load import history')
  const body = (await res.json()) as { runs: ImportRunListItem[] }
  return body.runs
}

const STATUS_LABEL: Record<ImportRunListItem['status'], string> = {
  pending: 'Queued',
  dry_run: 'Validating',
  running: 'Importing',
  completed: 'Completed',
  failed: 'Failed',
}

const STATUS_VARIANT: Record<
  ImportRunListItem['status'],
  'secondary' | 'default' | 'destructive' | 'outline'
> = {
  pending: 'secondary',
  dry_run: 'secondary',
  running: 'default',
  completed: 'outline',
  failed: 'destructive',
}

const SOURCE_LABEL: Record<ImportRunListItem['source'], string> = {
  csv: 'CSV',
  uservoice: 'UserVoice',
  canny: 'Canny',
  api: 'API',
}

function downloadErrorReport(run: ImportRunListItem): void {
  const blob = new Blob([JSON.stringify(run.errorReport ?? [], null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `import-errors-${run.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function ImportHistoryList() {
  const { data: runs, isLoading } = useQuery({
    queryKey: ['import-runs'],
    queryFn: fetchImportRuns,
    refetchInterval: (query) => {
      const rows = query.state.data
      return rows?.some((r) => IN_FLIGHT_STATUSES.has(r.status)) ? 2000 : false
    },
  })

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading import history...</p>
  }

  if (!runs || runs.length === 0) {
    return (
      <EmptyState
        icon={ArchiveBoxIcon}
        title="No imports yet"
        description="Runs you launch from the wizard above show up here with their status and counts."
        className="py-8"
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>File</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Counts</TableHead>
            <TableHead>Started</TableHead>
            <TableHead className="text-right">Errors</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>{SOURCE_LABEL[run.source]}</TableCell>
              <TableCell className="max-w-[220px] truncate" title={run.fileName}>
                {run.fileName}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[run.status]}>{STATUS_LABEL[run.status]}</Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {run.totals ? (
                  <>
                    {run.totals.created} created
                    {run.totals.updated > 0 && `, ${run.totals.updated} updated`}
                    {run.totals.skipped > 0 && `, ${run.totals.skipped} skipped`}
                  </>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <TimeAgo date={run.createdAt} />
              </TableCell>
              <TableCell className="text-right">
                {run.errorReport && run.errorReport.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => downloadErrorReport(run)}>
                    <ArrowDownTrayIcon className="size-4" />
                    {run.errorReport.length}
                  </Button>
                ) : (
                  <span className="text-sm text-muted-foreground">0</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
