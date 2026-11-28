/**
 * Participants dialog (§4.8 group threads): an agent adds a second customer to
 * an open conversation by email address — or removes one. Adding resolves the
 * address server-side to a principal (existing account, prior lead, or a
 * freshly minted one); a removed customer stops receiving replies with the
 * next send. The dialog lists the customers currently added, so a repeat add
 * is visible rather than silently idempotent and every row carries its own
 * remove affordance.
 */
import { useOptionalIntl } from '@/components/ui/use-optional-intl'
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
import {
  addConversationParticipantFn,
  removeConversationParticipantFn,
  listConversationParticipantsFn,
} from '@/lib/server/functions/conversation'
import { toastError } from '@/lib/client/error-notice'

export const AddParticipantDialog = memo(function AddParticipantDialog({
  open,
  onOpenChange,
  conversationId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: ConversationId
}) {
  const intl = useOptionalIntl()
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
        intl.formatMessage({
          id: 'admin.inbox.addParticipantDialog.customerAddedTheyWill',
          defaultMessage: 'Customer added. They will receive future replies by email.',
        })
      )
      setEmail('')
      void participantsQuery.refetch()
    } catch (err) {
      toastError(
        err,
        intl.formatMessage({
          id: 'admin.inbox.addParticipantDialog.addFailed',
          defaultMessage: 'Failed to add customer',
        })
      )
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
        intl.formatMessage({
          id: 'admin.inbox.addParticipantDialog.customerRemovedTheyNo',
          defaultMessage: 'Customer removed. They no longer receive replies.',
        })
      )
      void participantsQuery.refetch()
    } catch (err) {
      toastError(
        err,
        intl.formatMessage({
          id: 'admin.inbox.addParticipantDialog.removeFailed',
          defaultMessage: 'Failed to remove customer',
        })
      )
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({
              id: 'admin.inbox.addParticipantDialog.conversationCustomers',
              defaultMessage: 'Conversation customers',
            })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({
              id: 'admin.inbox.addParticipantDialog.addAnotherCustomerTo',
              defaultMessage:
                'Add another customer to this conversation. They receive every future reply by email until removed.',
            })}
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
            placeholder={intl.formatMessage({
              id: 'admin.inbox.addParticipantDialog.customerExampleCom',
              defaultMessage: 'customer@example.com',
            })}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label={intl.formatMessage({
              id: 'admin.inbox.addParticipantDialog.customerEmail',
              defaultMessage: 'Customer email',
            })}
          />
          {participants.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {participants.map((p) => (
                <li key={p.principalId} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {p.displayName ? `${p.displayName} · ` : ''}
                    {p.email ??
                      intl.formatMessage({
                        id: 'admin.inbox.addParticipantDialog.noEmail',
                        defaultMessage: 'no email',
                      })}
                  </span>
                  <button
                    type="button"
                    aria-label={intl.formatMessage(
                      {
                        id: 'admin.inbox.addParticipantDialog.remove',
                        defaultMessage: 'Remove {name}',
                      },
                      {
                        name:
                          p.email ??
                          p.displayName ??
                          intl.formatMessage({
                            id: 'admin.inbox.addParticipantDialog.customer',
                            defaultMessage: 'customer',
                          }),
                      }
                    )}
                    title={intl.formatMessage({
                      id: 'admin.inbox.addParticipantDialog.removeFromConversation',
                      defaultMessage: 'Remove from conversation',
                    })}
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
              {pending
                ? intl.formatMessage({
                    id: 'admin.inbox.addParticipantDialog.adding',
                    defaultMessage: 'Adding…',
                  })
                : intl.formatMessage({
                    id: 'admin.inbox.addParticipantDialog.addCustomer',
                    defaultMessage: 'Add customer',
                  })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
})
