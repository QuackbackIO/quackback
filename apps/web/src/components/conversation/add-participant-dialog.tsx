/**
 * Add-customer dialog (§4.8 group threads): an agent adds a second customer to
 * an open conversation by email address. The address resolves server-side to a
 * principal (existing account, prior lead, or a freshly minted one) and the
 * added customer receives every subsequent agent reply by email. The dialog
 * also lists the customers already added, so a repeat add is visible rather
 * than silently idempotent.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ConversationId } from '@quackback/ids'
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
import {
  addConversationParticipantFn,
  listConversationParticipantsFn,
} from '@/lib/server/functions/conversation'

export function AddParticipantDialog({
  open,
  onOpenChange,
  conversationId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: ConversationId
}) {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
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
      toast.success('Customer added — they will receive future replies by email')
      setEmail('')
      void participantsQuery.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add customer')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a customer</DialogTitle>
          <DialogDescription>
            Add another customer to this conversation. They receive every future reply by email.
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
                <li key={p.principalId} className="truncate">
                  {p.displayName ? `${p.displayName} — ` : ''}
                  {p.email ?? 'no email'}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="submit" size="sm" disabled={pending || !email.trim()}>
              {pending ? 'Adding…' : 'Add customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
