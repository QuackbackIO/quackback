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
import { getSesDomainIdentity } from '@quackback/email/ses-identity'
import type { ChannelAccountId, SendingDomainId, TeamId, UserId } from '@quackback/ids'
import type { ChannelAccount, EmailSendingDomain } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { isUniqueViolation } from '@/lib/server/utils/pg-error'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
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
  type SendingIdentityContext,
} from './outbound-identity'
import {
  CUSTOM_DOMAINS_UNAVAILABLE_MESSAGE,
  SendingDomainRefusedError,
  customSendingDomainsAvailable,
  provisionSendingDomain,
} from './sending-identity'

const log = logger.child({ component: 'sending-address' })

type SendingModule = 'support' | 'feedback' | 'changelog'

/**
 * Which addresses this server lets a workspace add.
 *
 * - `any`: one workspace, so the send guard permits any From. Every address is
 *   accepted, and an unverified domain is still offered setup when this server
 *   can set domains up.
 * - `verified-domains`: shared, and domains can be set up. An address on an
 *   unverified domain brings its domain with it.
 * - `unavailable`: shared, and domains cannot be set up. Only addresses the
 *   guard already permits.
 */
export type SendingAddressMode = 'any' | 'verified-domains' | 'unavailable'

/** The mode for a guard context: the same answer the guard gives for an unknown From. */
function addressModeFor(ctx: SendingIdentityContext): SendingAddressMode {
  if (!ctx.pooled) return 'any'
  return customSendingDomainsAvailable() ? 'verified-domains' : 'unavailable'
}

export async function sendingAddressMode(): Promise<SendingAddressMode> {
  return addressModeFor(await sendingIdentityContext())
}

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
 * - In `any` mode the address is accepted regardless: a setup that cannot
 *   happen leaves it unlinked, as it always was there, and a domain the
 *   provider already reports verified is left as it is. In `unavailable` mode
 *   it is refused.
 * - Two adds racing to set up the same new domain share the row that won.
 */
export async function addSendingAddress(input: {
  owningTeamId: TeamId
  address: string
  module: SendingModule
}): Promise<ChannelAccount> {
  const address = input.address.trim().toLowerCase()
  const domain = domainOfAddress(address)
  const ctx = await sendingIdentityContext()
  const mode = addressModeFor(ctx)
  const domains = await listSendingDomains(input.owningTeamId)

  // Asked as if the server were shared, so "may send" means a real reason to,
  // not the single-workspace allowance that permits everything.
  if (isSendingIdentityPermitted(address, { ...ctx, pooled: true })) {
    const covering = domain ? verifiedCovering(domains, domain) : undefined
    return createSendingAddress({ ...input, address, sendingDomainId: covering?.id })
  }
  if (mode === 'unavailable') {
    throw new SendingDomainRefusedError(CUSTOM_DOMAINS_UNAVAILABLE_MESSAGE)
  }
  if (!customSendingDomainsAvailable()) return createSendingAddress({ ...input, address })

  const sameDomain = (d: EmailSendingDomain) => toAsciiDomain(d.domain) === domain
  let row = domains.find(sameDomain)
  let created = false
  if (!row) {
    try {
      // A single workspace may have verified the domain with the provider by
      // hand. Setting it up again here would only get in the way of that.
      if (mode === 'any' && (await getSesDomainIdentity(domain ?? ''))?.verifiedForSending) {
        return createSendingAddress({ ...input, address })
      }
      row = await provisionSendingDomain({ owningTeamId: input.owningTeamId, domain: domain ?? '' })
      created = true
    } catch (err) {
      // Another add for the same new domain inserted its row first: use it.
      // Refused at the plan cap is the same race when that add took the last
      // slot, so it reads the domains again too.
      if (isUniqueViolation(err) || err instanceof TierLimitError) {
        row = (await listSendingDomains(input.owningTeamId)).find(sameDomain)
      }
      if (!row) {
        if (mode !== 'any') throw err
        log.warn({ err, domain }, 'sending domain setup failed; adding the address without it')
        return createSendingAddress({ ...input, address })
      }
    }
  }
  try {
    return await createSendingAddress({ ...input, address, sendingDomainId: row.id })
  } catch (err) {
    // A domain set up for this address and nothing else would hold a plan
    // slot with no address to use it.
    if (created) await deleteSendingDomain(row.id)
    throw err
  }
}

/**
 * The domain an unlinked address sends through, found by its zone: the first
 * of this workspace's domains, newest first, that the address is at or under.
 * The settings page resolves it the same way, so what it promises on removal
 * is what happens.
 */
async function domainByZone(account: ChannelAccount): Promise<EmailSendingDomain | null> {
  const own = account.address ? domainOfAddress(account.address) : null
  if (!own) return null
  const domains = await listSendingDomains(account.owningTeamId)
  return domains.find((d) => isAtOrUnder(own, toAsciiDomain(d.domain))) ?? null
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
  if (!account) return { lastOnDomain: null }

  const domain = account.sendingDomainId
    ? await getSendingDomain(account.sendingDomainId)
    : await domainByZone(account)
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
