/**
 * Version history + rollback (support platform §4.6): a two-pane Sheet
 * (modeled structurally on ../workflow-runs-sheet.tsx) listing a workflow's
 * saved versions newest-first — one row per meaningful save (see
 * workflow-versions.ts's doc for exactly when a save produces one) — with
 * the selected version's summary + a Restore action on the right.
 *
 * Restore reuses the same updateWorkflow write path a normal save does (see
 * functions/workflows.ts's restoreWorkflowVersionFn), so it re-validates the
 * snapshot and, being an ordinary update, itself produces a fresh version
 * row — the list keeps growing forward, it never "un-does" history. It
 * never touches status: a live/paused/draft workflow stays exactly as it
 * was before the restore.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ClockIcon } from '@heroicons/react/24/outline'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/ui/time-ago'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { MENU_LABEL } from '@/components/ui/menu'
import { cn } from '@/lib/shared/utils'
import { workflowKeys, workflowVersionsQuery } from '@/lib/client/queries/workflows'
import { restoreWorkflowVersionFn, type WorkflowVersionDTO } from '@/lib/server/functions/workflows'
import { triggerLabel } from '../workflow-graph'

function VersionRow({
  version,
  isCurrent,
  selected,
  onSelect,
}: {
  version: WorkflowVersionDTO
  isCurrent: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
        selected ? 'bg-primary/10' : 'hover:bg-muted/60'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="truncate font-medium">{version.name}</span>
        {isCurrent && (
          <Badge size="sm" shape="pill" variant="outline" className="shrink-0">
            Current
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <TimeAgo date={version.createdAt} />
        {version.createdByName && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">{version.createdByName}</span>
          </>
        )}
      </div>
    </button>
  )
}

export function VersionHistorySheet({
  workflowId,
  open,
  onOpenChange,
  dirty,
}: {
  workflowId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Disables Restore while the builder has unsaved changes — restoring
   *  would otherwise silently discard them. */
  dirty: boolean
}) {
  const queryClient = useQueryClient()
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { data: versions, isLoading } = useQuery(workflowVersionsQuery(open ? workflowId : null))

  // Default to the newest version whenever the list (re)loads.
  useEffect(() => {
    if (!open) {
      setSelectedVersionId(null)
      return
    }
    if (versions && versions.length > 0 && !versions.some((v) => v.id === selectedVersionId)) {
      setSelectedVersionId(versions[0]!.id)
    }
    if (versions && versions.length === 0) setSelectedVersionId(null)
    // Only re-derive off `versions`/`open`; selectedVersionId is intentionally read, not depended on.
  }, [versions, open])

  const restoreMutation = useMutation({
    mutationFn: (versionId: string) =>
      restoreWorkflowVersionFn({ data: { workflowId, versionId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.detail(workflowId) })
      queryClient.invalidateQueries({ queryKey: workflowKeys.versions(workflowId) })
      queryClient.invalidateQueries({ queryKey: workflowKeys.all() })
      toast.success('Workflow restored')
      setConfirmOpen(false)
      onOpenChange(false)
    },
    onError: () => toast.error('Could not restore this version. Try again.'),
  })

  const selected = versions?.find((v) => v.id === selectedVersionId) ?? null
  const isNewest = (id: string) =>
    Boolean(versions && versions.length > 0 && versions[0]!.id === id)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b">
            <SheetTitle>Version history</SheetTitle>
            <p className="text-xs text-muted-foreground">
              Saved states of this workflow, newest first.
            </p>
          </SheetHeader>

          {isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : !versions || versions.length === 0 ? (
            <EmptyState
              icon={ClockIcon}
              title="No versions yet"
              description="A version is saved every time this workflow's trigger, settings, or steps meaningfully change."
            />
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-2 divide-x">
              <div className="min-h-0 overflow-y-auto p-2">
                {versions.map((version) => (
                  <VersionRow
                    key={version.id}
                    version={version}
                    isCurrent={isNewest(version.id)}
                    selected={version.id === selectedVersionId}
                    onSelect={() => setSelectedVersionId(version.id)}
                  />
                ))}
              </div>
              <div className="flex min-h-0 flex-col overflow-y-auto p-3">
                {selected ? (
                  <>
                    <div className={cn('mb-2 px-1', MENU_LABEL)}>Version summary</div>
                    <dl className="space-y-2 px-1 text-[13px]">
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">Name</dt>
                        <dd className="truncate font-medium">{selected.name}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">Trigger</dt>
                        <dd className="truncate">{triggerLabel(selected.triggerType)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">Steps</dt>
                        <dd>
                          {selected.nodeCount} node{selected.nodeCount === 1 ? '' : 's'} ·{' '}
                          {selected.edgeCount} connection{selected.edgeCount === 1 ? '' : 's'}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">Saved</dt>
                        <dd>
                          <TimeAgo date={selected.createdAt} />
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 px-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isNewest(selected.id) || dirty}
                        onClick={() => setConfirmOpen(true)}
                      >
                        Restore this version
                      </Button>
                      {dirty && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Save or discard changes first.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="px-1 text-sm text-muted-foreground">Select a version.</div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Restore this version?"
        description="The workflow's name, trigger, and steps will be replaced with this saved state. Its live/paused/draft status won't change, and this creates a new version too — nothing is lost."
        confirmLabel="Restore"
        isPending={restoreMutation.isPending}
        onConfirm={() => {
          if (selected) restoreMutation.mutate(selected.id)
        }}
      />
    </>
  )
}
