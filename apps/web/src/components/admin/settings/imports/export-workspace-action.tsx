import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/ui/time-ago'
import { toast } from 'sonner'
import { fetchExportRuns } from './export-history-list'

const IN_FLIGHT_STATUSES = new Set(['pending', 'running'])

/**
 * The "Export workspace data" action: starts the async export and reflects
 * the in-flight run. Shares the ['export-runs'] query cache with the history
 * list, so starting a run here immediately polls/disables everywhere.
 */
export function ExportWorkspaceAction() {
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data: runs } = useQuery({
    queryKey: ['export-runs'],
    queryFn: fetchExportRuns,
    refetchInterval: (query) =>
      query.state.data?.some((r) => IN_FLIGHT_STATUSES.has(r.status)) ? 2000 : false,
  })
  const activeRun = runs?.find((r) => IN_FLIGHT_STATUSES.has(r.status))

  async function startExport() {
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/export/workspace', { method: 'POST' })
      if (res.status === 202) {
        toast.success('Export started — it will appear below in a moment.')
      } else if (res.status === 409) {
        toast.info('An export is already running.')
      } else if (res.status === 402) {
        toast.error('Data export is a Pro feature — upgrade to use it.')
      } else if (res.status === 403) {
        toast.error('Only admins can export workspace data.')
      } else {
        toast.error('Could not start the export. Please try again.')
      }
    } catch {
      toast.error('Could not start the export. Please try again.')
    } finally {
      setIsSubmitting(false)
      await queryClient.invalidateQueries({ queryKey: ['export-runs'] })
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={startExport} disabled={isSubmitting || activeRun != null}>
        <ArrowDownTrayIcon className="size-4" />
        {activeRun ? 'Exporting…' : 'Export workspace data'}
      </Button>
      {activeRun && (
        <span className="text-sm text-muted-foreground">
          started <TimeAgo date={activeRun.createdAt} />
        </span>
      )}
    </div>
  )
}
