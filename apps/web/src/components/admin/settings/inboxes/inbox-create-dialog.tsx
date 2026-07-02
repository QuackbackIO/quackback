/**
 * Create-inbox dialog. Captures slug + display name + a few defaults; submit
 * calls `createInboxFn`, then navigates to the new inbox detail page.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { TeamId, TicketStatusId, InboxId } from '@quackback/ids'
import { createInboxFn } from '@/lib/server/functions/inboxes'
import { inboxQueries } from '@/lib/client/queries/inboxes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TeamPicker } from '@/components/admin/shared/team-picker'
import { StatusPicker } from '@/components/admin/shared/status-picker'

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const VISIBILITY = ['team', 'org', 'shared', 'private'] as const

export function InboxCreateDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const qc = useQueryClient()

  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [primaryTeamId, setPrimaryTeamId] = useState<TeamId | null>(null)
  const [defaultStatusId, setDefaultStatusId] = useState<TicketStatusId | null>(null)
  const [defaultVisibilityScope, setDefaultVisibilityScope] =
    useState<(typeof VISIBILITY)[number]>('team')
  const [defaultPriority, setDefaultPriority] = useState<(typeof PRIORITIES)[number]>('normal')
  const [color, setColor] = useState('')
  const [icon, setIcon] = useState('')

  const reset = () => {
    setSlug('')
    setName('')
    setDescription('')
    setPrimaryTeamId(null)
    setDefaultStatusId(null)
    setDefaultVisibilityScope('team')
    setDefaultPriority('normal')
    setColor('')
    setIcon('')
  }

  const mutation = useMutation({
    mutationFn: () =>
      createInboxFn({
        data: {
          slug: slug.trim(),
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
    onSuccess: (inbox) => {
      qc.invalidateQueries({ queryKey: inboxQueries.list().queryKey })
      qc.invalidateQueries({ queryKey: ['inboxes'] })
      toast.success('Inbox created')
      setOpen(false)
      reset()
      router.navigate({
        to: '/admin/settings/inboxes/$inboxId',
        params: { inboxId: inbox.id as InboxId },
      })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New inbox</DialogTitle>
          <DialogDescription>
            An inbox is a named queue with its own channels, members and routing defaults.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!slug.trim() || !name.trim()) {
              toast.error('Slug and name are required')
              return
            }
            mutation.mutate()
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="support"
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer support"
                required
                maxLength={200}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
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
              <Label htmlFor="color">Color</Label>
              <Input
                id="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#22c55e"
                maxLength={16}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="icon">Icon</Label>
              <Input
                id="icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="InboxIcon"
                maxLength={64}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create inbox'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
