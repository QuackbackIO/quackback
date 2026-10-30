/**
 * Participants dialog (§4.8 group threads): an agent adds a second customer to
 * an open conversation by email address — or removes one. Adding resolves the
 * address server-side to a principal (existing account, prior lead, or a
 * freshly minted one); a removed customer stops receiving replies with the
 * next send. The dialog lists the customers currently added, so a repeat add
 * is visible rather than silently idempotent and every row carries its own
 * remove affordance.
 *
 * On a conversation that is a customer ticket's thread, adding someone shares
 * the ticket with them (ticket-sharing.service): they also see and reply on the
 * thread in the portal and the widget, and follow the ticket. The copy says so.
 */
import { memo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { XMarkIcon } from '@heroicons/react/24/solid'
import type { ConversationId, PrincipalId } from '@quackback/ids'
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
import { formatTicketNumber } from '@/lib/shared/tickets'
import {
  addConversationParticipantFn,
  removeConversationParticipantFn,
  listConversationParticipantsFn,
} from '@/lib/server/functions/conversation'

export const AddParticipantDialog = memo(function AddParticipantDialog({
  open,
  onOpenChange,
  conversationId,
  sharedTicketNumber,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: ConversationId
  /** Set when the conversation is a customer ticket's thread: adding someone
   *  shares the ticket with them. */
  sharedTicketNumber?: number | null
}) {
  const ticketLabel = sharedTicketNumber != null ? formatTicketNumber(sharedTicketNumber) : null
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const participantsQuery = useQuery({
    queryKey: ['conversation-participants', conversationId],
    queryFn: () => listConversationParticipantsFn({ data: { conversationId } }),
    enabled: open,
  })
  const participants = participantsQuery.data?.participants ?? []

  const submit = async () => {
    const trimmed = email.trim()
    if (!trimmed || pending) return
    setPending(true)
    try {
      await addConversationParticipantFn({ data: { conversationId, email: trimmed } })
      toast.success(
        ticketLabel
          ? `Shared ${ticketLabel}: they can see and reply on the thread`
          : 'Customer added — they will receive future replies by email'
      )
      setEmail('')
      void participantsQuery.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add customer')
    } finally {
      setPending(false)
    }
  }

  const remove = async (principalId: PrincipalId) => {
    if (removingId) return
    setRemovingId(principalId)
    try {
      await removeConversationParticipantFn({ data: { conversationId, principalId } })
      toast.success(
        ticketLabel
          ? `Stopped sharing ${ticketLabel} with them`
          : 'Customer removed — they no longer receive replies'
      )
      void participantsQuery.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove customer')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ticketLabel ? 'Shared with' : 'Conversation customers'}</DialogTitle>
          <DialogDescription>
            {ticketLabel
              ? `Share ${ticketLabel} with another customer. They can see and reply on its thread in the portal and the widget, follow its progress, and get its replies by email until removed.`
              : 'Add another customer to this conversation. They receive every future reply by email until removed.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex flex-col gap-3"
        >
          <Input
            type="email"
            required
            placeholder="customer@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Customer email"
          />
          {participants.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {participants.map((p) => (
                <li key={p.principalId} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {p.displayName ? `${p.displayName} — ` : ''}
                    {p.email ?? 'no email'}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${p.email ?? p.displayName ?? 'customer'}`}
                    title={ticketLabel ? 'Stop sharing with them' : 'Remove from conversation'}
                    disabled={removingId === p.principalId}
                    onClick={() => void remove(p.principalId)}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <XMarkIcon className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="submit" size="sm" disabled={pending || !email.trim()}>
              {pending ? 'Adding…' : ticketLabel ? 'Share ticket' : 'Add customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
})
