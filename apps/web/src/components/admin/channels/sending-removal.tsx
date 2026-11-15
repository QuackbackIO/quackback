/**
 * Removing a sending address or a sending domain: what the confirmation says
 * and what it does, in one place for every page that offers it (Settings →
 * Email and a domain's own page).
 */
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import {
  useDeleteChannelAccount,
  useDeleteSendingDomain,
} from '@/lib/client/mutations/channel-accounts'
import type { EmailSendersDTO, SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { SENDER_SURFACE_NAMES } from './send-from-card'

export type SendingAddress = {
  id: string
  address: string | null
  senderName?: string | null
  config: Record<string, unknown>
  sendingDomainId?: string | null
  sendingDomain: { domain: string; status: string } | null
  createdAt?: string
  /** Whether email can leave from it right now (the send guard's answer). */
  sendable: boolean
}

/** "Feedback board and Changelog", "Support, Feedback board and Changelog". */
const listOf = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/**
 * The domain row an address sends through: the one it is linked to, else the
 * one whose zone it is in (addresses added before linking carry no id).
 */
export function domainOf(
  a: Pick<SendingAddress, 'address' | 'sendingDomainId'>,
  domains: SendingDomainDTO[]
): SendingDomainDTO | null {
  if (a.sendingDomainId) {
    const linked = domains.find((d) => d.id === a.sendingDomainId)
    if (linked) return linked
  }
  const at = a.address?.split('@')[1]?.toLowerCase()
  if (!at) return null
  return domains.find((d) => at === d.domain || at.endsWith(`.${d.domain}`)) ?? null
}

/**
 * What removing an address does to the email that sends from it, in one
 * sentence: the kinds that override to it fall back to the default, and when
 * it is the default, everything it sends falls to the platform address.
 * Support counts as using the address behind its inbox.
 */
export function removalNote(
  id: string,
  senders: EmailSendersDTO,
  platformFrom: string | null,
  platformName: string
): string | null {
  if (senders.default?.mode === 'address' && senders.default.id === id) {
    return `It's your default address, so email will come from ${platformFrom ?? `the ${platformName.toLowerCase()}`} instead.`
  }
  const using = (
    Object.keys(SENDER_SURFACE_NAMES) as Array<keyof typeof SENDER_SURFACE_NAMES>
  ).filter((s) => {
    const choice = senders[s]
    return (
      (choice?.mode === 'address' && choice.id === id) ||
      (choice?.mode === 'inbox' && choice.fallbackId === id)
    )
  })
  if (using.length === 0) return null
  return `${listOf(using.map((s) => SENDER_SURFACE_NAMES[s]))} email will come from your default address instead.`
}

export interface AddressRemoval {
  id: string
  address: string
  /** The domain that goes with it, when this is the last address on it. */
  alsoDomain: string | null
  note: string | null
}

export interface DomainRemoval {
  id: string
  domain: string
}

interface RemovalDialogProps<T> {
  /** What is being removed; null keeps the dialog closed. */
  target: T | null
  onClose: () => void
  /** Called as the removal starts, to clear an earlier error. */
  onStart?: () => void
  /** Makes the handler for a failure, given the line to fall back to. */
  onError: (fallback: string) => (error: unknown) => void
  /** Called once everything the dialog removes has been tried. */
  onRemoved?: () => void
}

/** Confirms and removes one sending address, and its domain when it was the last on it. */
export function RemoveAddressDialog({
  target,
  onClose,
  onStart,
  onError,
  onRemoved,
}: RemovalDialogProps<AddressRemoval>) {
  const del = useDeleteChannelAccount()
  const removeDomain = useDeleteSendingDomain()
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
      title={target?.address ? `Remove ${target.address}?` : 'Remove address?'}
      description={[
        target?.note ?? 'Email can no longer be sent from this address.',
        target?.alsoDomain ? `${target.alsoDomain} will be removed too.` : null,
      ]
        .filter(Boolean)
        .join(' ')}
      confirmLabel="Remove address"
      variant="destructive"
      isPending={del.isPending}
      onConfirm={() => {
        if (target) {
          const { id, alsoDomain } = target
          onStart?.()
          del.mutate(id, {
            // Only the domain the dialog named, and only when the server
            // agrees no address uses it any more.
            onSuccess: ({ lastOnDomain }) => {
              if (alsoDomain && lastOnDomain?.domain === alsoDomain) {
                removeDomain.mutate(lastOnDomain.id, {
                  onError: onError("Couldn't remove the domain."),
                  onSettled: onRemoved,
                })
              } else {
                onRemoved?.()
              }
            },
            onError: onError("Couldn't remove the address."),
          })
        }
        onClose()
      }}
    />
  )
}

/**
 * Confirms and removes a sending domain no address uses. `emailOnly` is for a
 * page that shows the domain's other uses too: it says only email stops.
 */
export function RemoveDomainDialog({
  target,
  onClose,
  onStart,
  onError,
  onRemoved,
  emailOnly = false,
}: RemovalDialogProps<DomainRemoval> & { emailOnly?: boolean }) {
  const removeDomain = useDeleteSendingDomain()
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
      title={
        !target
          ? 'Remove domain?'
          : emailOnly
            ? `Stop sending email from ${target.domain}?`
            : `Remove ${target.domain}?`
      }
      description={
        emailOnly
          ? 'Its email DNS records can be deleted afterwards. Its other uses stay as they are.'
          : 'Its DNS records can be deleted afterwards.'
      }
      confirmLabel={emailOnly ? 'Stop sending email' : 'Remove domain'}
      variant="destructive"
      isPending={removeDomain.isPending}
      onConfirm={() => {
        if (target) {
          onStart?.()
          removeDomain.mutate(target.id, {
            onError: onError("Couldn't remove the domain."),
            onSuccess: onRemoved,
          })
        }
        onClose()
      }}
    />
  )
}
