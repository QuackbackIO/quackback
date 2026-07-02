/**
 * Overview tab for an inbox detail page. Editable form for name/description/
 * defaults plus an Archive / Unarchive button. Slug is read-only because
 * `updateInboxFn` does not accept it.
 */
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Inbox } from '@/lib/shared/db-types'
import type { TeamId, TicketStatusId } from '@quackback/ids'
import { updateInboxFn, archiveInboxFn, unarchiveInboxFn } from '@/lib/server/functions/inboxes'
import { inboxQueries } from '@/lib/client/queries/inboxes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { TeamPicker } from '@/components/admin/shared/team-picker'
import { StatusPicker } from '@/components/admin/shared/status-picker'

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const VISIBILITY = ['team', 'org', 'shared', 'private'] as const

export interface InboxOverviewTabProps {
  inbox: Inbox
}

export function InboxOverviewTab({ inbox }: InboxOverviewTabProps) {
  const qc = useQueryClient()
  const [name, setName] = useState(inbox.name)
  const [description, setDescription] = useState(inbox.description ?? '')
  const [primaryTeamId, setPrimaryTeamId] = useState<TeamId | null>(
    inbox.primaryTeamId as TeamId | null
  )
  const [defaultStatusId, setDefaultStatusId] = useState<TicketStatusId | null>(
    inbox.defaultStatusId as TicketStatusId | null
  )
  const [defaultVisibilityScope, setDefaultVisibilityScope] = useState<(typeof VISIBILITY)[number]>(
    inbox.defaultVisibilityScope as (typeof VISIBILITY)[number]
  )
  const [defaultPriority, setDefaultPriority] = useState<(typeof PRIORITIES)[number]>(
    inbox.defaultPriority as (typeof PRIORITIES)[number]
  )
  const [color, setColor] = useState(inbox.color ?? '')
  const [icon, setIcon] = useState(inbox.icon ?? '')

  // Reset local state when the inbox prop changes (after a refetch).
  useEffect(() => {
    setName(inbox.name)
    setDescription(inbox.description ?? '')
    setPrimaryTeamId(inbox.primaryTeamId as TeamId | null)
    setDefaultStatusId(inbox.defaultStatusId as TicketStatusId | null)
    setDefaultVisibilityScope(inbox.defaultVisibilityScope as (typeof VISIBILITY)[number])
    setDefaultPriority(inbox.defaultPriority as (typeof PRIORITIES)[number])
    setColor(inbox.color ?? '')
    setIcon(inbox.icon ?? '')
  }, [inbox])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: inboxQueries.detail(inbox.id).queryKey })
    qc.invalidateQueries({ queryKey: inboxQueries.list().queryKey })
    qc.invalidateQueries({ queryKey: ['inboxes'] })
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateInboxFn({
        data: {
          inboxId: inbox.id,
          name: name.trim(),
          description: description.trim() || null,
          primaryTeamId: primaryTeamId ?? null,
          defaultStatusId: defaultStatusId ?? null,
          defaultVisibilityScope,
          defaultPriority,
          color: color.trim() || null,
          icon: icon.trim() || null,
        },
      }),
    onSuccess: () => {
      invalidate()
      toast.success('Inbox updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const archiveMutation = useMutation({
    mutationFn: () => archiveInboxFn({ data: { inboxId: inbox.id } }),
    onSuccess: () => {
      invalidate()
      toast.success('Inbox archived')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const unarchiveMutation = useMutation({
    mutationFn: () => unarchiveInboxFn({ data: { inboxId: inbox.id } }),
    onSuccess: () => {
      invalidate()
      toast.success('Inbox unarchived')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4 max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) {
            toast.error('Name is required')
            return
          }
          saveMutation.mutate()
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Slug</Label>
            <Input value={inbox.slug} disabled readOnly className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inbox-name">Name</Label>
            <Input
              id="inbox-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="inbox-description">Description</Label>
          <Textarea
            id="inbox-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>

        <div className="space-y-1">
          <Label>Primary team</Label>
          <TeamPicker
            value={primaryTeamId}
            onValueChange={setPrimaryTeamId}
            allowClear
            placeholder="No team"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Default visibility</Label>
            <Select
              value={defaultVisibilityScope}
              onValueChange={(v) => setDefaultVisibilityScope(v as (typeof VISIBILITY)[number])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Default priority</Label>
            <Select
              value={defaultPriority}
              onValueChange={(v) => setDefaultPriority(v as (typeof PRIORITIES)[number])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label>Default status</Label>
          <StatusPicker
            value={defaultStatusId}
            onValueChange={setDefaultStatusId}
            placeholder="Workspace default"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="inbox-color">Color</Label>
            <Input
              id="inbox-color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#22c55e"
              maxLength={16}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inbox-icon">Icon</Label>
            <Input
              id="inbox-icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="InboxIcon"
              maxLength={64}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>

      <div className="border-t border-border/50 pt-4">
        <h3 className="text-sm font-semibold mb-2">Archive</h3>
        {inbox.archivedAt ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Archived. Tickets in this inbox remain accessible but new routing rules will skip it.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => unarchiveMutation.mutate()}
              disabled={unarchiveMutation.isPending}
            >
              Unarchive
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Hide this inbox from queues and routing. Existing tickets are preserved.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Archive…
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive this inbox?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Members will no longer see it in their saved views. You can unarchive it later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => archiveMutation.mutate()}>
                    Archive
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </div>
  )
}
