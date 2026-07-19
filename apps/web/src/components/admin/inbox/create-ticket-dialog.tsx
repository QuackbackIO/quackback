import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { XMarkIcon } from '@heroicons/react/24/solid'
import type { JSONContent } from '@tiptap/react'
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'
import type { TicketType, TiptapContent } from '@/lib/shared/db-types'
import { TICKET_TYPES } from '@/lib/shared/db-types'
import { useCreateTicket } from '@/lib/client/mutations/inbox'
import { linkTicketToConversationFn } from '@/lib/server/functions/tickets'
import { ticketTypeLabel } from '@/components/admin/inbox/ticket-chips'
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

export interface CreateTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new ticket's id on success (both standalone and
   *  from-a-conversation flows) — the caller navigates to it. */
  onCreated: (ticketId: TicketId) => void
  /** Set when opened from a conversation (unified inbox §M5's create-ticket
   *  flow: header icon, the panel's Ticket card empty slot, or the command
   *  bar with a conversation active). Locks the type to 'customer', fixes the
   *  requester to the conversation's visitor (no picker), and links the new
   *  ticket back to this conversation on success. */
  conversationId?: ConversationId
  /** Prefill from the conversation's subject or first message. Only read
   *  when `conversationId` is set (the standalone flow starts blank). */
  defaultTitle?: string
  /** The conversation's visitor, prefilled as the fixed requester. Only read
   *  when `conversationId` is set. */
  defaultRequester?: Requester | null
  /** Refresh the caller's lists/thread after a successful create (+ link) —
   *  the conversation thread gains a system note announcing the ticket. */
  onChanged?: () => void
}

/**
 * Open a ticket. Standalone (no `conversationId`): pick a type + title, and
 * optionally attach a requester — the general-purpose flow (command bar with
 * no conversation active, or the pre-unified tickets page). From a
 * conversation (`conversationId` set): the type is locked to 'customer', the
 * requester is fixed to the conversation's visitor, and a successful create
 * links the ticket back to the conversation (`linkTicketToConversationFn`) —
 * a friendly conflict (one customer ticket per conversation, already linked)
 * still counts as "created", just not (re-)linked.
 */
export function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
  conversationId,
  defaultTitle,
  defaultRequester,
  onChanged,
}: CreateTicketDialogProps) {
  const fromConversation = !!conversationId
  const [type, setType] = useState<TicketType>('customer')
  const [title, setTitle] = useState('')
  const [descriptionJson, setDescriptionJson] = useState<JSONContent | undefined>(undefined)
  const [descriptionMarkdown, setDescriptionMarkdown] = useState('')
  const [requester, setRequester] = useState<Requester | null>(null)

  // A fresh open starts clean — prefilled from the conversation when opened
  // in that mode.
  useEffect(() => {
    if (open) {
      setType('customer')
      setTitle(fromConversation ? (defaultTitle ?? '') : '')
      setDescriptionJson(undefined)
      setDescriptionMarkdown('')
      setRequester(fromConversation ? (defaultRequester ?? null) : null)
    }
  }, [open, fromConversation, defaultTitle, defaultRequester])

  const create = useCreateTicket()
  const { upload: uploadImage } = useImageUpload({ prefix: 'chat-images' })
  const [linking, setLinking] = useState(false)
  const canCreate = title.trim().length > 0 && !create.isPending && !linking

  const submit = () => {
    if (!canCreate) return
    const description = descriptionMarkdown.trim()
    if (description.length > DESCRIPTION_MAX_LENGTH) {
      toast.error(`Description is too long (max ${DESCRIPTION_MAX_LENGTH} characters).`)
      return
    }
    create.mutate(
      {
        type: fromConversation ? 'customer' : type,
        title: title.trim(),
        description: description || undefined,
        descriptionJson: isEmptyTiptapDoc(descriptionJson as TiptapContent | undefined)
          ? null
          : (descriptionJson as TiptapContent),
        requesterPrincipalId: requester?.principalId as PrincipalId | undefined,
        // Lets the create inherit this conversation's assignee (born owned by
        // whoever owns the conversation); the link row itself is written by
        // the linkTicketToConversationFn step below.
        sourceConversationId: conversationId,
      },
      {
        onSuccess: async (ticket) => {
          if (conversationId) {
            setLinking(true)
            try {
              await linkTicketToConversationFn({ data: { ticketId: ticket.id, conversationId } })
              toast.success('Ticket created')
            } catch (error) {
              // The ticket itself was created successfully — a link failure
              // (e.g. this conversation already has one) is a secondary,
              // recoverable problem, not a reason to hide the new ticket.
              toast.warning(
                error instanceof Error
                  ? `Ticket created, but couldn't link it: ${error.message}`
                  : "Ticket created, but couldn't link it to this conversation"
              )
            } finally {
              setLinking(false)
            }
          } else {
            toast.success('Ticket created')
          }
          onOpenChange(false)
          onCreated(ticket.id)
          onChanged?.()
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
          <DialogTitle>{fromConversation ? 'Create ticket' : 'New ticket'}</DialogTitle>
          <DialogDescription>
            {fromConversation
              ? 'Open a trackable ticket for this conversation.'
              : 'Open a trackable request and set who it is for.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!fromConversation && (
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
          )}

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
              {fromConversation ? 'Requester' : 'Requester (optional)'}
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
                {/* The conversation's visitor is fixed — only the standalone
                    flow's picked requester can be cleared. */}
                {!fromConversation && (
                  <button
                    type="button"
                    onClick={() => setRequester(null)}
                    aria-label="Clear requester"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <XMarkIcon className="size-4" />
                  </button>
                )}
              </div>
            ) : fromConversation ? (
              <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                Anonymous visitor — no portal account on file.
              </p>
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
            {create.isPending || linking ? 'Creating…' : 'Create ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
