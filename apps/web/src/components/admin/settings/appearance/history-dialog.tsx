import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PortalDesignRevisionId } from '@quackback/ids'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TimeAgo } from '@/components/ui/time-ago'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'

const SOURCE: Record<string, string> = {
  appearance: 'Appearance',
  ai: 'Quackback AI',
  api: 'API',
  mcp: 'MCP',
  import: 'Import',
  conversion: 'Conversion',
  restore: 'Restore',
}

/** Published versions, newest first, each restorable as the next version. */
export function HistoryDialog({
  open,
  onOpenChange,
  currentNumber,
  onRestore,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentNumber: number | null
  onRestore: (
    revisionId: PortalDesignRevisionId
  ) => Promise<{ ok: true } | { ok: false; message: string }>
}) {
  const versions = useQuery({ ...portalDesignQueries.versions(), enabled: open })
  const [confirming, setConfirming] = useState<{
    id: PortalDesignRevisionId
    number: number
  } | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  async function restore() {
    if (!confirming) return
    const outcome = await onRestore(confirming.id)
    setConfirming(null)
    if (outcome.ok) onOpenChange(false)
    else setRefusal(outcome.message)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Versions</DialogTitle>
            <DialogDescription>
              Restoring publishes that version again. Your draft stays.
            </DialogDescription>
          </DialogHeader>
          {versions.data?.length === 0 && (
            <p className="text-[13px] text-muted-foreground">Nothing published yet.</p>
          )}
          <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {versions.data?.map((version) => (
              <li key={version.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="w-10 shrink-0 font-medium tabular-nums">v{version.number}</span>
                <span className="min-w-0 flex-1 truncate">
                  {version.message ?? SOURCE[version.source] ?? version.source}
                  <span className="text-muted-foreground">
                    {' · '}
                    <TimeAgo date={version.createdAt} />
                  </span>
                </span>
                {version.number === currentNumber ? (
                  <span className="text-xs text-muted-foreground">Live</span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setConfirming({
                        id: version.id as PortalDesignRevisionId,
                        number: version.number,
                      })
                    }
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {refusal && (
            <p role="alert" className="text-[13px] text-destructive">
              {refusal}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming !== null} onOpenChange={(next) => !next && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore version {confirming?.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Visitors see it straight away. It becomes the newest version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={restore}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
