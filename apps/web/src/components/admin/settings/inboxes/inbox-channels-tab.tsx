/**
 * Channels tab for an inbox detail page. Lists existing channels with inline
 * enable toggles + edit + archive buttons. Add/edit/archive are gated by the
 * `INBOX_CHANNEL_MANAGE` permission.
 */
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { InboxId, InboxChannelId } from '@quackback/ids'
import { updateInboxChannelFn, archiveInboxChannelFn } from '@/lib/server/functions/inboxes'
import { inboxQueries } from '@/lib/client/queries/inboxes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { TrashIcon, PencilSquareIcon, PlusIcon } from '@heroicons/react/24/outline'
import { InboxChannelDialog } from './inbox-channel-dialog'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const KIND_COLORS: Record<string, string> = {
  portal: 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200',
  email: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  api: 'bg-violet-100 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200',
  widget: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  webhook: 'bg-rose-100 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
}

export function InboxChannelsTab({ inboxId }: { inboxId: InboxId }) {
  const qc = useQueryClient()
  const { data: channels } = useSuspenseQuery(inboxQueries.channels(inboxId))

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: inboxQueries.channels(inboxId).queryKey })

  const toggleMutation = useMutation({
    mutationFn: (vars: { channelId: InboxChannelId; enabled: boolean }) =>
      updateInboxChannelFn({ data: { channelId: vars.channelId, enabled: vars.enabled } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  const archiveMutation = useMutation({
    mutationFn: (channelId: InboxChannelId) => archiveInboxChannelFn({ data: { channelId } }),
    onSuccess: () => {
      invalidate()
      toast.success('Channel archived')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-3 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Channels</h2>
          <p className="text-xs text-muted-foreground">
            Sources that can create tickets in this inbox.
          </p>
        </div>
        <PermissionGate permission={PERMISSIONS.INBOX_CHANNEL_MANAGE}>
          <InboxChannelDialog
            inboxId={inboxId}
            trigger={
              <Button size="sm">
                <PlusIcon className="h-4 w-4 mr-1" />
                Add channel
              </Button>
            }
          />
        </PermissionGate>
      </div>

      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>External ID</TableHead>
              <TableHead className="w-20">Enabled</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                  No channels yet.
                </TableCell>
              </TableRow>
            ) : (
              channels.map((ch) => (
                <TableRow key={ch.id}>
                  <TableCell>
                    <span
                      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${
                        KIND_COLORS[ch.kind] ?? 'bg-muted text-foreground'
                      }`}
                    >
                      {ch.kind}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">{ch.label}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {ch.externalId ?? '—'}
                  </TableCell>
                  <TableCell>
                    <PermissionGate
                      permission={PERMISSIONS.INBOX_CHANNEL_MANAGE}
                      fallback={
                        <Badge variant="outline" className="text-[10px]">
                          {ch.enabled ? 'on' : 'off'}
                        </Badge>
                      }
                    >
                      <Switch
                        checked={ch.enabled}
                        disabled={ch.archivedAt != null || toggleMutation.isPending}
                        onCheckedChange={(v) =>
                          toggleMutation.mutate({
                            channelId: ch.id as InboxChannelId,
                            enabled: v,
                          })
                        }
                        aria-label="Toggle channel enabled"
                      />
                    </PermissionGate>
                  </TableCell>
                  <TableCell>
                    {ch.archivedAt ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Archived
                      </Badge>
                    ) : (
                      <Badge variant="outline">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <PermissionGate permission={PERMISSIONS.INBOX_CHANNEL_MANAGE}>
                      <div className="flex items-center gap-1 justify-end">
                        <InboxChannelDialog
                          inboxId={inboxId}
                          channel={ch}
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              aria-label="Edit channel"
                            >
                              <PencilSquareIcon className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                        {ch.archivedAt == null && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                aria-label="Archive channel"
                              >
                                <TrashIcon className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Archive channel?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tickets that arrived via this channel are kept; new tickets will
                                  no longer flow through it.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => archiveMutation.mutate(ch.id as InboxChannelId)}
                                >
                                  Archive
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </PermissionGate>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
