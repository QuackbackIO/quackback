import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/empty-state'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  listIntegrationSyncHistoryFn,
  inspectIntegrationSyncFn,
  recoverIntegrationSyncFn,
  verifyIntegrationSyncReferenceFn,
} from '@/lib/server/functions/integration-sync'
import {
  SYNC_LABELS,
  SYNC_KIND_LABELS,
  type SyncAction,
  type SyncFilter,
  type SyncHistoryItem,
} from '@/lib/shared/integration-sync'

const filters: Array<[SyncFilter, string]> = [
  ['all', 'All'],
  ['attention', 'Needs attention'],
  ['progress', 'In progress'],
  ['successful', 'Successful'],
]
const actionLabels: Record<SyncAction, string> = {
  retry: 'Retry',
  cancel: 'Cancel',
  reconcile: 'Check result',
  keep_remote: 'Dismiss change',
  link_existing: 'Link existing item',
}
type Cursor = { at: string; id: string }

export function IntegrationSyncHistory({ provider }: { provider: string }) {
  const [filter, setFilter] = useState<SyncFilter>('all')
  const [cursors, setCursors] = useState<Cursor[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const actionIds = useRef(new Map<string, string>())
  const history = useQuery({
    queryKey: ['integration-sync', provider, filter, cursors.at(-1)],
    queryFn: () =>
      listIntegrationSyncHistoryFn({ data: { provider, filter, cursor: cursors.at(-1) } }),
    refetchInterval: 10_000,
  })
  const action = useMutation({
    mutationFn: ({ item, kind }: { item: SyncHistoryItem; kind: SyncAction }) => {
      const key = `${item.id}:${item.version}:${kind}`
      const actionId = actionIds.current.get(key) ?? crypto.randomUUID()
      actionIds.current.set(key, actionId)
      return recoverIntegrationSyncFn({
        data: { id: item.id, version: item.version, action: kind, actionId },
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integration-sync'] })
      await queryClient.invalidateQueries({ queryKey: ['integration-sync-detail'] })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not update this sync')
    },
  })
  return (
    <section aria-label="Sync history" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1" aria-label="Filter sync history">
          {filters.map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? 'secondary' : 'ghost'}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value)
                setCursors([])
                setExpanded(null)
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Refresh sync history"
          onClick={() => void history.refetch()}
          disabled={history.isFetching}
        >
          <ArrowPathIcon className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Activity from the last 90 days, plus unresolved syncs. Cancelling stops future attempts; it
        does not undo changes on the platform.
      </p>
      {history.isPending ? (
        <div role="status" aria-label="Loading sync history" className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-16 w-full" />
          ))}
        </div>
      ) : history.isError ? (
        <p role="alert" className="py-8 text-sm text-destructive">
          Could not load sync history. Try refreshing.
        </p>
      ) : !history.data.items.length ? (
        <EmptyState
          icon={ArrowPathIcon}
          title="No syncs to show"
          description={
            filter === 'all'
              ? 'New integration activity will appear here.'
              : 'No syncs match this filter.'
          }
          className="py-8"
        />
      ) : (
        <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/50 bg-card">
          {history.data.items.map((item) => (
            <div key={item.id}>
              <div className="flex flex-wrap items-start gap-3 p-4">
                <button
                  type="button"
                  disabled={!item.sourceTitle}
                  aria-expanded={item.sourceTitle ? expanded === item.id : undefined}
                  aria-controls={item.sourceTitle ? `sync-detail-${item.id}` : undefined}
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  className="min-w-0 basis-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:basis-60 sm:flex-1"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {item.sourceTitle && (
                      <ChevronDownIcon
                        className={`h-4 w-4 shrink-0 transition-transform ${expanded === item.id ? 'rotate-180' : ''}`}
                      />
                    )}
                    <span className="truncate" title={item.sourceTitle ?? undefined}>
                      {item.sourceTitle ?? 'Restricted or deleted item'}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {item.direction === 'outbound' ? 'To platform' : 'From platform'} ·{' '}
                    {SYNC_KIND_LABELS[item.kind] ?? 'Sync activity'} ·{' '}
                    <TimeAgo date={item.updatedAt} />
                  </span>
                  {item.destinationLabel && (
                    <span
                      className="mt-1 block truncate text-xs text-muted-foreground"
                      title={item.destinationLabel}
                    >
                      {item.destinationLabel}
                    </span>
                  )}
                  {item.cancelRequested && ['running', 'uncertain'].includes(item.state) && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Further attempts stopped
                    </span>
                  )}
                </button>
                <Badge
                  variant={
                    ['failed', 'auth_required'].includes(item.state)
                      ? 'destructive'
                      : item.state === 'succeeded'
                        ? 'outline'
                        : 'secondary'
                  }
                >
                  {SYNC_LABELS[item.state]}
                </Badge>
                <div className="flex flex-wrap gap-1">
                  {item.actions.map((kind) =>
                    kind === 'link_existing' ? (
                      <LinkExistingSyncItem key={kind} item={item} />
                    ) : (
                      <Button
                        key={kind}
                        size="sm"
                        variant="outline"
                        disabled={action.isPending}
                        onClick={() => action.mutate({ item, kind })}
                      >
                        {kind === 'keep_remote' &&
                        item.direction === 'outbound' &&
                        item.kind !== 'create'
                          ? 'Keep remote content'
                          : actionLabels[kind]}
                      </Button>
                    )
                  )}
                </div>
              </div>
              {expanded === item.id && item.sourceTitle && <SyncDetail item={item} />}
            </div>
          ))}
        </div>
      )}
      {(cursors.length > 0 || history.data?.nextCursor) && (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!cursors.length}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!history.data?.nextCursor}
            onClick={() => {
              if (history.data?.nextCursor) setCursors((c) => [...c, history.data.nextCursor!])
            }}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  )
}

function SyncDetail({ item }: { item: SyncHistoryItem }) {
  const incomingStatus = item.direction === 'inbound' && item.kind === 'status'
  const detail = useQuery({
    queryKey: ['integration-sync-detail', item.id, item.version],
    queryFn: () => inspectIntegrationSyncFn({ data: { id: item.id } }),
  })
  return (
    <div
      id={`sync-detail-${item.id}`}
      className="space-y-3 border-t border-border/50 bg-muted/20 p-4 text-sm"
    >
      {item.error && <p role="status">{item.error}</p>}
      <div className="flex gap-4">
        {item.sourceId && (
          <a
            className="text-xs underline"
            href={
              item.sourceType === 'post'
                ? `/admin/feedback?post=${encodeURIComponent(item.sourceId)}`
                : `/admin/inbox?i=${encodeURIComponent(item.sourceId)}`
            }
          >
            View source
          </a>
        )}
        {item.remoteUrl && (
          <a
            className="inline-flex items-center gap-1 text-xs underline"
            href={item.remoteUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {item.remoteDisplayId ?? 'View remote item'}
            <ArrowTopRightOnSquareIcon className="h-3 w-3" />
          </a>
        )}
      </div>
      {detail.isPending && <Skeleton aria-label="Loading sync details" className="h-16 w-full" />}
      {detail.isError && <p role="alert">Could not load details.</p>}
      {detail.data?.remote && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Current remote content</p>
          {detail.data.remote.externalUrl && (
            <a
              className="text-xs underline"
              href={detail.data.remote.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open on platform
            </a>
          )}
          <Textarea
            aria-label="Current remote content"
            readOnly
            value={`${detail.data.remote.title}\n\n${detail.data.remote.content}`}
            className="min-h-40"
          />
        </div>
      )}
      {detail.data?.preview && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {incomingStatus
              ? 'Received status from the platform. Review the source item and update its status manually if appropriate.'
              : 'Proposed content. Review the remote item and apply changes there to preserve its edits.'}
          </p>
          <Textarea
            aria-label={incomingStatus ? 'Received platform status' : 'Proposed sync content'}
            readOnly
            value={
              incomingStatus
                ? detail.data.preview.content
                : `${detail.data.preview.title}\n\n${detail.data.preview.content}`
            }
            className={incomingStatus ? 'min-h-16' : 'min-h-40'}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const preview = detail.data?.preview
              if (preview)
                void navigator.clipboard
                  .writeText(
                    incomingStatus ? preview.content : `${preview.title}\n\n${preview.content}`
                  )
                  .then(() => toast.success('Content copied'))
                  .catch(() => toast.error('Select the content to copy it'))
            }}
          >
            {incomingStatus ? 'Copy received status' : 'Copy proposed content'}
          </Button>
        </div>
      )}
      {!!detail.data?.attempts.length && (
        <ol className="space-y-2 text-xs text-muted-foreground">
          {detail.data.attempts.map((attempt) => (
            <li key={attempt.id}>
              Attempt {attempt.number} · {attemptLabel(attempt.state)} ·{' '}
              <TimeAgo date={attempt.startedAt} />
              {attempt.error && <span className="block">{attempt.error}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function LinkExistingSyncItem({ item }: { item: SyncHistoryItem }) {
  const [open, setOpen] = useState(false)
  const [reference, setReference] = useState('')
  const request = useRef<{ key: string; id: string } | null>(null)
  const queryClient = useQueryClient()
  const verify = useMutation({
    mutationFn: () => verifyIntegrationSyncReferenceFn({ data: { id: item.id, reference } }),
    onError: () => toast.error('Could not verify this item in the original destination.'),
  })
  const link = useMutation({
    mutationFn: () => {
      const key = `${item.id}:${item.version}:${reference}:${verify.data?.externalId}`
      if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
      return recoverIntegrationSyncFn({
        data: {
          id: item.id,
          version: item.version,
          actionId: request.current.id,
          action: 'link_existing',
          reference,
          expectedRemoteId: verify.data?.externalId,
        },
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integration-sync'] })
      await queryClient.invalidateQueries({ queryKey: ['integration-sync-detail'] })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] })
      toast.success('Remote item linked')
      setOpen(false)
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Link existing item
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!link.isPending) setOpen(value)
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Link existing item</DialogTitle>
            <DialogDescription>
              Find the item created by this sync. Verify its reference, then confirm the link to
              avoid creating another item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor={`sync-reference-${item.id}`}>Remote issue reference</Label>
            <Input
              id={`sync-reference-${item.id}`}
              value={reference}
              onChange={(e) => {
                setReference(e.target.value)
                verify.reset()
              }}
              disabled={verify.isPending || link.isPending}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!reference.trim() || verify.isPending || link.isPending}
              onClick={() => verify.mutate()}
            >
              Verify item
            </Button>
            {verify.data && (
              <div className="space-y-2">
                <p>
                  {verify.data.externalDisplayId}: {verify.data.title}
                </p>
                {verify.data.externalUrl && (
                  <a
                    href={verify.data.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline"
                  >
                    Open on platform
                  </a>
                )}
              </div>
            )}
            {verify.isError && (
              <p role="alert" className="text-sm text-destructive">
                Could not verify this item. Check the reference and try again.
              </p>
            )}
            {link.isError && (
              <p role="alert" className="text-sm text-destructive">
                {link.error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={link.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!verify.data || link.isPending} onClick={() => link.mutate()}>
              {link.isPending ? 'Linking…' : 'Confirm link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function attemptLabel(state: string): string {
  if (state in SYNC_LABELS) return SYNC_LABELS[state as keyof typeof SYNC_LABELS]
  return (
    (
      {
        remote_succeeded: 'Remote change confirmed',
        manually_verified: 'Manually linked',
        late_result: 'Late result received',
        interrupted: 'Interrupted',
      } as Record<string, string>
    )[state] ?? 'Recorded'
  )
}
