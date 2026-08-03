/**
 * Add/edit dialog for inbox channels. The channel kind is locked once created
 * because the backend `updateInboxChannelFn` does not accept it. Per-kind
 * config fields are intentionally minimal in v1; the backend stores them as
 * an opaque jsonb record.
 */
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { InboxId, InboxChannelId } from '@quackback/ids'
import type { InboxChannel } from '@/lib/shared/db-types'
import { addInboxChannelFn, updateInboxChannelFn } from '@/lib/server/functions/inboxes'
import { inboxQueries } from '@/lib/client/queries/inboxes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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

const CHANNEL_KINDS = ['portal', 'email', 'api', 'widget', 'webhook'] as const
type ChannelKind = (typeof CHANNEL_KINDS)[number]

export interface InboxChannelDialogProps {
  inboxId: InboxId
  channel?: InboxChannel
  trigger: React.ReactNode
}

export function InboxChannelDialog({ inboxId, channel, trigger }: InboxChannelDialogProps) {
  const isEdit = channel != null
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  const initialConfig = (channel?.config ?? {}) as Record<string, string | undefined>

  const [kind, setKind] = useState<ChannelKind>((channel?.kind as ChannelKind) ?? 'portal')
  const [label, setLabel] = useState(channel?.label ?? '')
  const [externalId, setExternalId] = useState(channel?.externalId ?? '')
  const [enabled, setEnabled] = useState(channel?.enabled ?? true)

  // Per-kind config inputs.
  const [mailbox, setMailbox] = useState(String(initialConfig.mailbox ?? ''))
  const [forwardingAddress, setForwardingAddress] = useState(
    String(initialConfig.forwardingAddress ?? '')
  )
  const [secret, setSecret] = useState('')
  const [signingHeader, setSigningHeader] = useState(String(initialConfig.signingHeader ?? ''))

  useEffect(() => {
    if (!open) return
    setKind((channel?.kind as ChannelKind) ?? 'portal')
    setLabel(channel?.label ?? '')
    setExternalId(channel?.externalId ?? '')
    setEnabled(channel?.enabled ?? true)
    const cfg = (channel?.config ?? {}) as Record<string, string | undefined>
    setMailbox(String(cfg.mailbox ?? ''))
    setForwardingAddress(String(cfg.forwardingAddress ?? ''))
    setSecret('')
    setSigningHeader(String(cfg.signingHeader ?? ''))
  }, [channel, open])

  const buildConfig = (): Record<string, unknown> => {
    if (kind === 'email') {
      return {
        ...(mailbox.trim() ? { mailbox: mailbox.trim() } : {}),
        ...(forwardingAddress.trim() ? { forwardingAddress: forwardingAddress.trim() } : {}),
      }
    }
    if (kind === 'webhook') {
      const merged: Record<string, unknown> = {
        ...(channel?.config ?? {}),
        ...(signingHeader.trim() ? { signingHeader: signingHeader.trim() } : {}),
      }
      // Only persist secret if user typed one (write-only field).
      if (secret.trim()) merged.secret = secret.trim()
      return merged
    }
    return {}
  }

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: inboxQueries.channels(inboxId).queryKey })

  const createMutation = useMutation({
    mutationFn: () =>
      addInboxChannelFn({
        data: {
          inboxId,
          kind,
          label: label.trim(),
          externalId: externalId.trim() || null,
          enabled,
          config: buildConfig(),
        },
      }),
    onSuccess: () => {
      invalidate()
      toast.success('Channel added')
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      updateInboxChannelFn({
        data: {
          channelId: channel!.id as InboxChannelId,
          label: label.trim(),
          externalId: externalId.trim() || null,
          enabled,
          config: buildConfig(),
        },
      }),
    onSuccess: () => {
      invalidate()
      toast.success('Channel updated')
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const submitting = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit channel' : 'Add channel'}</DialogTitle>
          <DialogDescription>Channels feed tickets into this inbox.</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!label.trim()) {
              toast.error('Label is required')
              return
            }
            if (isEdit) updateMutation.mutate()
            else createMutation.mutate()
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ChannelKind)} disabled={isEdit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-[11px] text-muted-foreground">
                Channel kind cannot change after creation.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="channel-label">Label</Label>
            <Input
              id="channel-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              maxLength={200}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="channel-external-id">External ID</Label>
            <Input
              id="channel-external-id"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              maxLength={200}
              placeholder="provider-side identifier"
            />
          </div>

          {kind === 'email' && (
            <>
              <div className="space-y-1">
                <Label htmlFor="ch-mailbox">Mailbox</Label>
                <Input
                  id="ch-mailbox"
                  value={mailbox}
                  onChange={(e) => setMailbox(e.target.value)}
                  placeholder="support@example.com"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ch-forwarding">Forwarding address</Label>
                <Input
                  id="ch-forwarding"
                  value={forwardingAddress}
                  onChange={(e) => setForwardingAddress(e.target.value)}
                  placeholder="optional"
                />
              </div>
            </>
          )}

          {kind === 'webhook' && (
            <>
              <div className="space-y-1">
                <Label htmlFor="ch-signing-header">Signing header</Label>
                <Input
                  id="ch-signing-header"
                  value={signingHeader}
                  onChange={(e) => setSigningHeader(e.target.value)}
                  placeholder="X-Webhook-Signature"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ch-secret">
                  Secret {isEdit && '(leave blank to keep current)'}
                </Label>
                <Input
                  id="ch-secret"
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </>
          )}

          {(kind === 'portal' || kind === 'widget' || kind === 'api') && (
            <p className="text-xs text-muted-foreground border border-border/50 rounded p-2">
              No additional configuration required.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Switch id="ch-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="ch-enabled" className="font-normal">
              Enabled
            </Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Save channel' : 'Add channel'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
