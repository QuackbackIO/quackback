/**
 * The email config as every page that shows sending reads it: addresses named
 * and checked, what the platform address is called, and the props the Send
 * from card takes. Kept apart from the pages so a domain's page derives it the
 * same way without loading Settings → Email.
 */
import { useQuery } from '@tanstack/react-query'
import { namedAddress } from '@quackback/email/named-address'
import { emailChannelConfigQuery } from '@/lib/client/queries/channel-accounts'
import type {
  EmailChannelConfigDTO,
  EmailSendersDTO,
} from '@/lib/server/functions/channel-accounts'
import { domainOf, type SendingAddress } from './sending-removal'
import { ownDomains } from './sending-address-dialog'
import { domainPhase } from './sending-domain-view'
import type { SenderIdentity } from './send-from-card'

export type AddressMode = EmailChannelConfigDTO['addressMode']

const NO_SENDERS: EmailSendersDTO = {
  default: null,
  support: null,
  feedback: null,
  changelog: null,
  status: null,
}

/**
 * What the address email sends from with nothing chosen is called: one
 * workspace on its own server falls back to that server's own address.
 */
export const platformAddressName = (mode: AddressMode | undefined): string =>
  mode === 'any' ? 'Server default' : 'Quackback address'

/** "Sender name <address>", the sender name being the workspace's when unset. */
export const senderLabel = (a: SendingAddress, workspaceName: string): string =>
  namedAddress(a.senderName ?? workspaceName, a.address ?? '')

/** Oldest first: the order the pages list addresses and offer them in. */
export const oldestFirst = <T extends SendingAddress>(addresses: T[]): T[] =>
  [...addresses].sort((x, y) => (x.createdAt ?? '').localeCompare(y.createdAt ?? ''))

/** The address mail to the support inbox is forwarded from, when one is set. */
export function inboundTarget(
  route: { config: Record<string, unknown> } | null | undefined
): string | null {
  const t = route?.config?.forwardingTarget
  return typeof t === 'string' ? t : null
}

export function useEmailConfigView() {
  const { data } = useQuery(emailChannelConfigQuery())
  const workspaceName = data?.workspaceName ?? ''
  const addresses = data?.sendingAddresses ?? []
  const domains = data?.domains ?? []
  const senders = data?.senders ?? NO_SENDERS
  // Named by the server, the way the send itself names it.
  const platformFrom = data?.defaultFrom ?? null
  const platformName = platformAddressName(data?.addressMode)
  // Whether an address can send is the send guard's answer, from the server.
  const now = new Date()
  const identities: SenderIdentity[] = oldestFirst(addresses).map((a) => {
    const domain = domainOf(a, domains)
    return {
      id: a.id,
      label: senderLabel(a, workspaceName),
      live: a.sendable,
      lapsed: !a.sendable && !!domain && domainPhase(domain, now) === 'attention',
    }
  })
  return {
    data,
    addressMode: data?.addressMode,
    workspaceName,
    addresses,
    domains,
    senders,
    platformFrom,
    platformName,
    /** The platform's own domains, which an address needs no setup to send from. */
    ownDomains: ownDomains(data?.platformAddress, data?.defaultFrom),
    identities,
    /** What both Send from cards are given, spread into the card. */
    sendFrom: {
      senders,
      identities,
      platformFrom,
      platformName,
      // The workspace's own inbox on the platform, which a reply to an
      // emailed-in conversation falls back to before the platform's address.
      platformInbox: data?.platformAddress
        ? namedAddress(workspaceName, data.platformAddress)
        : null,
      forwardingTarget: inboundTarget(data?.inboundRoute),
      forwardingTargetPermitted: data?.forwardingTargetPermitted ?? null,
      hasInboundRoute: !!data?.inboundRoute,
    },
  }
}
