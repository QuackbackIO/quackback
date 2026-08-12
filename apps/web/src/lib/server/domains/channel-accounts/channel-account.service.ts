/**
 * Channel accounts + sending domains (support platform §4.8 Layer 2). The email
 * channel's connected instances: one `inbound` route per workspace (the front
 * door a conversation's channel_account_id points at) and N `sending` addresses
 * (the verified From identities per module), plus the SPF/DKIM sending domains.
 *
 * Pure CRUD + resolvers; no permission gate here. The settings UX that creates
 * these (a later slice) gates at the fn layer, like the other domains. Inert
 * until the cold-inbound + outbound slices consume the resolvers.
 */
import {
  db,
  eq,
  and,
  or,
  isNull,
  inArray,
  desc,
  sql,
  channelAccounts,
  conversations,
  emailSendingDomains,
  teams,
  type ChannelAccount,
  type EmailSendingDomain,
  type ChannelAccountConfig,
  type SendingDomainDnsRecord,
} from '@/lib/server/db'
import type { ChannelAccountId, ConversationId, SendingDomainId, TeamId } from '@quackback/ids'
import type { SendingIdentity } from '@quackback/email/sender'
import { enforceSendingDomainLimit } from '@/lib/server/domains/settings/tier-enforce'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { permittedSendingIdentity } from './outbound-identity'

type SendingModule = 'support' | 'feedback' | 'changelog'

// ---------------------------------------------------------------------------
// Sending domains (SPF/DKIM verified)
// ---------------------------------------------------------------------------

/**
 * The one insert path for a sending domain, and the one place the plan's cap on
 * them is enforced.
 *
 * The cap is not an ordinary count limit. Every other one bounds what a
 * workspace can do to its own database; this one bounds what a workspace can do
 * to the mail provider account the whole fleet shares, which has an identity
 * quota of its own. A read-compare-then-act check is honest about the count it
 * saw and useless about the count that results: concurrent callers all read the
 * same number, all pass, and all go on to consume a slot. So the count and the
 * insert happen inside one transaction behind an advisory lock, which makes
 * "there were fewer than N" a fact about the moment the row was written rather
 * than about a moment before it.
 *
 * The lock is transaction-scoped and taken on a constant, so it serialises only
 * sending-domain creation and releases on commit or abort without a cleanup
 * path. Contention is a person clicking Add, so serialising it costs nothing.
 */
export async function createSendingDomain(input: {
  owningTeamId: TeamId
  domain: string
  dnsRecords?: SendingDomainDnsRecord[]
}): Promise<EmailSendingDomain> {
  const limit = (await getTierLimits()).maxSendingDomains
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('quackback:sending_domain_slot'))`)
    await enforceSendingDomainLimit(limit, tx)
    const [row] = await tx
      .insert(emailSendingDomains)
      .values({
        owningTeamId: input.owningTeamId,
        domain: input.domain.trim().toLowerCase(),
        dnsRecords: input.dnsRecords ?? [],
      })
      .returning()
    return row
  })
}

export async function listSendingDomains(owningTeamId: TeamId): Promise<EmailSendingDomain[]> {
  return db
    .select()
    .from(emailSendingDomains)
    .where(eq(emailSendingDomains.owningTeamId, owningTeamId))
    .orderBy(desc(emailSendingDomains.createdAt))
}

/** Every sending domain in this workspace, for the scheduled re-check. */
export async function listAllSendingDomains(): Promise<EmailSendingDomain[]> {
  return db.select().from(emailSendingDomains).orderBy(desc(emailSendingDomains.createdAt))
}

export async function getSendingDomain(id: SendingDomainId): Promise<EmailSendingDomain | null> {
  const [row] = await db
    .select()
    .from(emailSendingDomains)
    .where(eq(emailSendingDomains.id, id))
    .limit(1)
  return row ?? null
}

/**
 * Remove a sending domain, freeing the plan slot it held.
 *
 * A hard delete, not a soft one, because the row IS the authority the send
 * guard reads: a tombstone that still matched `status = 'verified'` would keep
 * granting the address it was deleted to revoke. The unique index on
 * (team, domain) means the same domain can then be added again, which is the
 * other thing a typo needs.
 *
 * **The provider identity is deliberately left behind.** Nothing in this
 * codebase can delete one — see `@quackback/email/ses-identity` for why the
 * provisioning credential is not granted `ses:DeleteEmailIdentity` — so an
 * identity created for a domain that is then removed stays on the shared
 * account until an operator reaps it from the provider console. That is the
 * intended trade: a wrong delete stops every workspace on the account from
 * sending, and a leftover identity costs a line in a list. What an operator
 * does about it is check the account's identity list against the domains still
 * in use before the account approaches its quota; the plan cap is what keeps
 * that from becoming urgent.
 *
 * A sending address that named the removed domain is left alone and stops
 * resolving on its own: the guard refuses an address whose domain is no longer
 * verified, and the reply goes out from the platform sender instead of not
 * going out. Deleting those rows here would silently discard configuration a
 * person typed in order to fix a mistake they made next to it.
 */
export async function deleteSendingDomain(id: SendingDomainId): Promise<void> {
  await db.delete(emailSendingDomains).where(eq(emailSendingDomains.id, id))
}

// ---------------------------------------------------------------------------
// Channel accounts
// ---------------------------------------------------------------------------

/** The workspace's one inbound email route (the partial-unique enforces one). */
export async function createInboundRoute(input: {
  owningTeamId: TeamId
  config: ChannelAccountConfig
  inboundTrust?: 'strict' | 'lenient'
}): Promise<ChannelAccount> {
  const [row] = await db
    .insert(channelAccounts)
    .values({
      owningTeamId: input.owningTeamId,
      role: 'inbound',
      config: input.config,
      inboundTrust: input.inboundTrust ?? 'strict',
    })
    .returning()
  return row
}

/** A verified sending address for a module (the outbound From identity). */
export async function createSendingAddress(input: {
  owningTeamId: TeamId
  address: string
  module: SendingModule
  sendingDomainId?: SendingDomainId
  config?: ChannelAccountConfig
}): Promise<ChannelAccount> {
  const [row] = await db
    .insert(channelAccounts)
    .values({
      owningTeamId: input.owningTeamId,
      role: 'sending',
      address: input.address.trim().toLowerCase(),
      module: input.module,
      sendingDomainId: input.sendingDomainId ?? null,
      config: input.config ?? {},
    })
    .returning()
  return row
}

/** Resolve the workspace's inbound route (the inbox a conversation arrived on). */
export async function getInboundRoute(owningTeamId: TeamId): Promise<ChannelAccount | null> {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.owningTeamId, owningTeamId),
        eq(channelAccounts.role, 'inbound'),
        isNull(channelAccounts.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

/** Resolve the sending address for a module (the outbound From for a reply). */
export async function getSendingAddress(
  owningTeamId: TeamId,
  module: SendingModule
): Promise<ChannelAccount | null> {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.owningTeamId, owningTeamId),
        eq(channelAccounts.role, 'sending'),
        eq(channelAccounts.module, module),
        isNull(channelAccounts.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * The sending address an outbound message for a conversation should come from
 * (§4.8): the conversation's assigned team's sending address for the module, else
 * the default team's, else null so the caller falls back to the workspace default
 * (EMAIL_FROM). The one place the outbound From is resolved.
 *
 * Every answer passes the sending-identity guard on the way out. A row's mere
 * existence in this database is not authority to send as the address it holds:
 * the mail provider signs for any identity verified on the account it shares
 * with every other workspace, so a row naming a domain this workspace never
 * proved it owns would be an impersonation the provider would carry out. See
 * `outbound-identity.ts`.
 */
export async function resolveSendingAddress(
  assignedTeamId: TeamId | null,
  module: SendingModule = 'support'
): Promise<SendingIdentity | null> {
  let teamId = assignedTeamId
  if (!teamId) {
    const [def] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.isDefault, true))
      .limit(1)
    teamId = def?.id ?? null
  }
  if (!teamId) return null
  const account = await getSendingAddress(teamId, module)
  return permittedSendingIdentity(account?.address ?? null)
}

/**
 * The From for a reply on an email conversation: the address the customer wrote
 * to, when this workspace can prove it may send as it.
 *
 * Replying from the address that was written to is what every mail-shaped
 * support product does, and it is the point of a customer-owned sending domain:
 * a customer forwards `support@theircompany.com` in, and the reply has to leave
 * as `support@theircompany.com` or the thread visibly changes identity halfway
 * through. The inbound route records that address as its forwarding target, so
 * it is already known — what was missing was the ability to sign for it.
 *
 * Falls back, in order, to the team's configured sending address for the module
 * and then to null, which the caller reads as the branded workspace default.
 * Each candidate is guarded independently: an unverified inbox address must not
 * suppress a verified team address that would have been fine.
 */
export async function resolveConversationFrom(
  conversationId: ConversationId,
  module: SendingModule = 'support'
): Promise<SendingIdentity | null> {
  const [conv] = await db
    .select({
      assignedTeamId: conversations.assignedTeamId,
      channelAccountId: conversations.channelAccountId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)

  if (conv?.channelAccountId) {
    const account = await getChannelAccount(conv.channelAccountId)
    // A sending row carries its address in the column; an inbound route carries
    // the address mail was forwarded from in its config. Either is "the address
    // the customer wrote to" for the conversation bound to it.
    const inboxAddress = account?.address ?? account?.config?.forwardingTarget ?? null
    const permitted = await permittedSendingIdentity(inboxAddress)
    if (permitted) return permitted
  }

  return resolveSendingAddress(conv?.assignedTeamId ?? null, module)
}

export async function listChannelAccounts(owningTeamId: TeamId): Promise<ChannelAccount[]> {
  return db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.owningTeamId, owningTeamId), isNull(channelAccounts.deletedAt)))
    .orderBy(desc(channelAccounts.createdAt))
}

/**
 * Match a set of inbound recipient addresses to the channel account they landed
 * on — a `sending` address the mail was to/cc'd, or the `inbound` route's
 * forwarding target. The cold-inbound create path (§4.8) uses this to bind a new
 * email conversation to its inbox + owning team. Caller passes already-extracted,
 * lowercased addr-specs (no display names); returns the first match or null.
 */
export async function resolveChannelAccountByRecipient(
  addresses: string[]
): Promise<ChannelAccount | null> {
  const addrs = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))]
  if (addrs.length === 0) return null
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        isNull(channelAccounts.deletedAt),
        or(
          // A sending address is set only on 'sending' rows, so this can't
          // false-match an inbound route.
          inArray(channelAccounts.address, addrs),
          inArray(sql`(${channelAccounts.config} ->> 'forwardingTarget')`, addrs)
        )
      )
    )
    .limit(1)
  return row ?? null
}

export async function getChannelAccount(id: ChannelAccountId): Promise<ChannelAccount | null> {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.id, id), isNull(channelAccounts.deletedAt)))
    .limit(1)
  return row ?? null
}

export async function softDeleteChannelAccount(id: ChannelAccountId): Promise<void> {
  const now = new Date()
  await db
    .update(channelAccounts)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(channelAccounts.id, id), isNull(channelAccounts.deletedAt)))
}
