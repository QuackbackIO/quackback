import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { XMarkIcon } from '@heroicons/react/24/solid'
import type { JSONContent } from '@tiptap/react'
import type { PrincipalId, TicketId } from '@quackback/ids'
import type { TicketType, TiptapContent } from '@/lib/shared/db-types'
import { TICKET_TYPES } from '@/lib/shared/db-types'
import { createTicketFn } from '@/lib/server/functions/tickets'
import { ticketKeys } from '@/lib/client/queries/tickets'
import { ticketTypeLabel } from '@/components/admin/tickets/ticket-chips'
import { realEmail } from '@/lib/shared/anonymous-email'
import { PortalUserPicker } from '@/components/shared/portal-user-picker'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { CONVERSATION_EDITOR_FEATURES } from '@/components/conversation/conversation-editor-features'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Native `<textarea maxLength>` used to silently cap this field; a rich doc
// can't be truncated mid-node without corrupting it, so the cap is now
// enforced pre-submit with the same toast the dialog already uses for
// mutation errors.
const DESCRIPTION_MAX_LENGTH = 4000

interface Requester {
  principalId: string
  name: string | null
  email: string | null
  image?: string | null
}

/**
 * Open a new ticket: pick a type + title, and optionally attach a requester. On
 * success the parent selects the new ticket.
 */
export function NewTicketDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (ticketId: TicketId) => void
}) {
  const [type, setType] = useState<TicketType>('customer')
  const [title, setTitle] = useState('')
  const [descriptionJson, setDescriptionJson] = useState<JSONContent | undefined>(undefined)
  const [descriptionMarkdown, setDescriptionMarkdown] = useState('')
  const [requester, setRequester] = useState<Requester | null>(null)

  // A fresh open starts clean.
  useEffect(() => {
    if (open) {
      setType('customer')
      setTitle('')
      setDescriptionJson(undefined)
      setDescriptionMarkdown('')
      setRequester(null)
    }
  }, [open])

  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: (vars: {
      type: TicketType
      title: string
      description?: string
      descriptionJson?: TiptapContent | null
      requesterPrincipalId?: PrincipalId
    }) => createTicketFn({ data: vars }),
    onSuccess: (ticket) => {
      queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket)
      void queryClient.invalidateQueries({ queryKey: ticketKeys.lists() })
    },
  })
  const { upload: uploadImage } = useImageUpload({ prefix: 'chat-images' })
  const canCreate = title.trim().length > 0 && !create.isPending

  const submit = () => {
    if (!canCreate) return
    const description = descriptionMarkdown.trim()
    if (description.length > DESCRIPTION_MAX_LENGTH) {
      toast.error(`Description is too long (max ${DESCRIPTION_MAX_LENGTH} characters).`)
      return
    }
    create.mutate(
      {
        type,
        title: title.trim(),
        description: description || undefined,
        descriptionJson: isEmptyTiptapDoc(descriptionJson as TiptapContent | undefined)
          ? null
          : (descriptionJson as TiptapContent),
        requesterPrincipalId: requester?.principalId as PrincipalId | undefined,
      },
      {
        onSuccess: (ticket) => {
          toast.success('Ticket created')
          onOpenChange(false)
          onCreated(ticket.id)
        },
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : 'Failed to create ticket'),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New ticket</DialogTitle>
          <DialogDescription>Open a trackable request and set who it is for.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <Select value={type} onValueChange={(v) => setType(v as TicketType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ticketTypeLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              placeholder="Summarize the request…"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <RichTextEditor
              value={descriptionJson ?? ''}
              onChange={(json, _html, markdown) => {
                setDescriptionJson(json)
                setDescriptionMarkdown(markdown)
              }}
              features={CONVERSATION_EDITOR_FEATURES}
              onImageUpload={uploadImage}
              minHeight="120px"
              placeholder="Add details (optional). This opens the ticket thread."
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Requester (optional)
            </label>
            {requester ? (
              <div className="flex items-center gap-2.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                <Avatar
                  src={requester.image}
                  name={requester.name ?? 'User'}
                  className="size-7 text-xs"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {requester.name || 'Unnamed user'}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {realEmail(requester.email) ?? 'No email'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setRequester(null)}
                  aria-label="Clear requester"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <XMarkIcon className="size-4" />
                </button>
              </div>
            ) : (
              <PortalUserPicker
                onSelect={(u) => setRequester(u)}
                enabled={open && !requester}
                limit={6}
                searchRequired
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canCreate}>
            {create.isPending ? 'Creating…' : 'Create ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
