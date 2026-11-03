/**
 * Sending addresses and the domains they bring with them.
 *
 * A person adds an address, not a domain. When the address is on a domain this
 * workspace has not verified, adding it sets that domain up (or reuses the one
 * already being set up) and links the two, and the address sends from the
 * default until its domain is live: the send guard reads the domain's status,
 * not the address row, so nothing here widens what may be sent.
 *
 * A domain lives while an address uses it. Removing the last address on one
 * says so, and the person decides whether the domain goes too.
 */
import { getEmailFrom, sendRawEmail } from '@quackback/email'
import { addressDomain } from '@quackback/email/ses'
import type { ChannelAccountId, SendingDomainId, TeamId, UserId } from '@quackback/ids'
import type { ChannelAccount, EmailSendingDomain } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { resolveAccountRecipient } from '@/lib/server/email/recipient'
import {
  createSendingAddress,
  deleteSendingDomain,
  getChannelAccount,
  getSendingDomain,
  listChannelAccounts,
  listSendingDomains,
  softDeleteChannelAccount,
} from './channel-account.service'
import {
  isAtOrUnder,
  isSendingIdentityPermitted,
  permittedSendingIdentity,
  sendingIdentityContext,
  toAsciiDomain,
} from './outbound-identity'
import {
  CUSTOM_DOMAINS_UNAVAILABLE_MESSAGE,
  SendingDomainRefusedError,
  customSendingDomainsAvailable,
  provisionSendingDomain,
} from './sending-identity'

const log = logger.child({ component: 'sending-address' })

type SendingModule = 'support' | 'feedback' | 'changelog'

/** The A-label domain of an address, or null when it has none. */
function domainOfAddress(address: string): string | null {
  const domain = addressDomain(address)
  return domain ? toAsciiDomain(domain) : null
}

/** The verified domain row that covers a domain, if this workspace has one. */
function verifiedCovering(domains: EmailSendingDomain[], domain: string) {
  return domains.find(
    (d) => d.status === 'verified' && isAtOrUnder(domain, toAsciiDomain(d.domain))
  )
}

/**
 * Add a sending address for an area, setting up its domain when it needs one.
 *
 * - An address the workspace may already send as (a verified domain covers
 *   it, or it is the platform's own or this workspace's minted address) is
 *   added as it always was, linked to the verified domain when there is one.
 * - Otherwise, where this server can set up domains, the address brings its
 *   domain: this workspace's row for it in whatever state, or a new one under
 *   the usual rules (plan cap, pre-flight, refusals).
 * - Otherwise a single-workspace server keeps adding it as before, since its
 *   send guard already permits any address, and a shared one refuses.
 */
export async function addSendingAddress(input: {
  owningTeamId: TeamId
  address: string
  module: SendingModule
}): Promise<ChannelAccount> {
  const address = input.address.trim().toLowerCase()
  const domain = domainOfAddress(address)
  const ctx = await sendingIdentityContext()
  const domains = await listSendingDomains(input.owningTeamId)

  // Asked as if the server were shared, so "may send" means a real reason to,
  // not the single-workspace allowance that permits everything.
  if (isSendingIdentityPermitted(address, { ...ctx, pooled: true })) {
    const covering = domain ? verifiedCovering(domains, domain) : undefined
    return createSendingAddress({ ...input, address, sendingDomainId: covering?.id })
  }

  if (!customSendingDomainsAvailable()) {
    if (isSendingIdentityPermitted(address, ctx)) {
      return createSendingAddress({ ...input, address })
    }
    throw new SendingDomainRefusedError(CUSTOM_DOMAINS_UNAVAILABLE_MESSAGE)
  }

  const existing = domain ? domains.find((d) => toAsciiDomain(d.domain) === domain) : undefined
  const row =
    existing ??
    (await provisionSendingDomain({ owningTeamId: input.owningTeamId, domain: domain ?? '' }))
  try {
    return await createSendingAddress({ ...input, address, sendingDomainId: row.id })
  } catch (err) {
    // A domain set up for this address and nothing else would hold a plan
    // slot with no address to use it.
    if (!existing) await deleteSendingDomain(row.id)
    throw err
  }
}

/**
 * Remove a sending address, and say whether it was the last one on its domain.
 *
 * "Last" counts every live sending address the domain covers, linked or not,
 * because an address added before addresses were linked still sends from it.
 */
export async function removeSendingAddress(
  id: ChannelAccountId
): Promise<{ lastOnDomain: { id: SendingDomainId; domain: string } | null }> {
  const account = await getChannelAccount(id)
  await softDeleteChannelAccount(id)
  if (!account?.sendingDomainId) return { lastOnDomain: null }

  const domain = await getSendingDomain(account.sendingDomainId)
  if (!domain) return { lastOnDomain: null }
  const zone = toAsciiDomain(domain.domain)
  const remaining = (await listChannelAccounts(account.owningTeamId)).filter((a) => {
    if (a.role !== 'sending') return false
    if (a.sendingDomainId === domain.id) return true
    const own = a.address ? domainOfAddress(a.address) : null
    return own !== null && isAtOrUnder(own, zone)
  })
  return remaining.length > 0
    ? { lastOnDomain: null }
    : { lastOnDomain: { id: domain.id, domain: domain.domain } }
}

/**
 * Send a short test from an address to the person asking, through the same
 * guard and provider path a reply takes, and report the From that went out.
 *
 * The recipient is always the caller's own account address, never an input,
 * so this cannot be used to mail anyone else.
 */
export async function sendTestEmail(input: {
  addressId: ChannelAccountId
  userId: UserId
}): Promise<{ from: string; to: string }> {
  const account = await getChannelAccount(input.addressId)
  if (!account || account.role !== 'sending' || !account.address) {
    throw new SendingDomainRefusedError('That address no longer exists.')
  }
  const address = account.address
  const domain = domainOfAddress(address)
  const domains = await listSendingDomains(account.owningTeamId)
  if (!domain || !verifiedCovering(domains, domain)) {
    throw new SendingDomainRefusedError(
      `${domain ?? address} isn't live yet. Send a test once its records are found.`
    )
  }

  const to = await resolveAccountRecipient(input.userId)
  if (!to) {
    throw new SendingDomainRefusedError('Your account has no email address to send the test to.')
  }

  const from =
    (await permittedSendingIdentity(address)) ?? (await permittedSendingIdentity(getEmailFrom()))
  if (!from) throw new SendingDomainRefusedError("The test email couldn't be sent.")

  const text = `This is a test from ${address}. If it arrived, replies can be sent from this address.`
  const result = await sendRawEmail({
    from,
    to,
    subject: `Test email from ${address}`,
    text,
    html: `<p>${text}</p>`,
  })
  if (!result.sent) {
    log.warn({ reason: result.reason }, 'test email not sent')
    throw new SendingDomainRefusedError("The test email couldn't be sent. Try again in a minute.")
  }
  return { from, to }
}
