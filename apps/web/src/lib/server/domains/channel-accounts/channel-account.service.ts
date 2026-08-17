/**
 * Channel accounts + sending domains (support platform §4.8 Layer 2). The email
 * channel's connected instances: one `inbound` route per workspace (the front
 * door a conversation's channel_account_id points at) and N `sending` addresses
 * (the verified From identities per module), plus the SPF/DKIM sending domains.
 *
 * Mostly CRUD + resolvers, with no permission gate: the settings UX that creates
 * these gates at the fn layer, like the other domains. The one rule that is not
 * CRUD is {@link ensurePlatformInboundRoute}, which owns the fact that a
 * workspace HAS an inbound address before anybody configures one.
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
import {
  isPlatformInboxRecipient,
  platformInboxAddress,
} from '@/lib/server/domains/conversation/conversation.email-channel'
import { currentMailSlug } from '@/lib/server/domains/conversation/conversation.mail-slug'
import { logger } from '@/lib/server/logger'
import { permittedSendingIdentity, withSendingDisplayName } from './outbound-identity'

const log = logger.child({ component: 'channel-accounts' })

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

/**
 * Which transport actually delivers this workspace's inbound mail.
 *
 * Recorded rather than left blank because it is what an operator reads back when
 * mail is not arriving, and a field naming a transport this deployment does not
 * run sends the next person debugging it to the wrong provider's dashboard.
 * Imported dynamically to keep the front door's module graph off every caller
 * that only wanted to read a row.
 */
async function inboundProvider(): Promise<ChannelAccountConfig['provider']> {
  const { isCloudflareInboundConfigured } =
    await import('@/lib/server/domains/conversation/email-cloudflare-handler')
  return isCloudflareInboundConfigured() ? 'cloudflare' : 'resend'
}

/** The workspace's default team, which owns email config in the v0. */
export async function defaultTeamId(): Promise<TeamId | null> {
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.isDefault, true))
    .limit(1)
  return row?.id ?? null
}

/**
 * Is this recipient set addressed to the workspace's PLATFORM INBOX —
 * `<mail slug>@<inbound domain>`, the address it has from the moment it exists?
 *
 * Pure and free of the database, so the cold-inbound path can ask it up front
 * (is this message ours at all?) and leave the WRITE that materialises the route
 * until after every gate that can refuse the message. Both readings are of the
 * same two facts: this process's mint domain and this workspace's slug.
 */
export function addressesPlatformInbox(recipients: string[]): boolean {
  const slug = currentMailSlug()
  // Both refusals are the grammar's, deliberately: no slug and no usable mint
  // domain each mean the workspace has no address of its own, and inventing one
  // would be a route to a mailbox nothing can deliver to.
  if (!platformInboxAddress(slug)) return false
  return recipients.some((recipient) => isPlatformInboxRecipient(recipient, slug))
}

/**
 * The workspace's inbound route for mail that arrived at its PLATFORM INBOX —
 * `<mail slug>@<inbound domain>`, the address it has from the moment it exists
 * — materialising that route the first time such a message arrives.
 *
 * ## Why a workspace needs this at all
 *
 * Cold inbound binds a new conversation to the front door it landed on, so
 * without a row there is no conversation to create and the message is dropped
 * with nothing retained. Every workspace that had one had it because a person
 * typed a forwarding address into settings, which is the OPT-IN half of the
 * design; the platform address is the DEFAULT half and nobody types it. A
 * workspace that had received no configuration therefore accepted mail at SMTP,
 * generated no bounce, told the sender nothing, and showed the customer nothing.
 *
 * ## Why the row is written here and not seeded somewhere earlier
 *
 * The two facts it is made of are not knowable where a workspace's other
 * defaults are seeded. The default team, the statuses and the boards are seeded
 * by the SQL migration bundle, which has no environment and so cannot know
 * `EMAIL_INBOUND_DOMAIN`; the mail slug is not in the database at all. That is
 * the same wall the identity-provider backfill hit, and it was answered the same
 * way: in-process, idempotent, where the value can actually be read. Boot is too
 * early for a workspace that did not exist at boot, and a periodic pass is a
 * window during which mail is still lost, so the moment that is neither is the
 * first message itself.
 *
 * ## What makes a write here safe on a path a stranger can reach
 *
 * Not one byte of the row comes from the message. Every column is a constant or
 * a fact about this process, and the message is only allowed to decide WHETHER
 * we look, by having been addressed to the platform inbox — decided from the
 * slug on the workspace scope the front door already established, never off a
 * header the message carries. One row is the most that can exist, enforced by
 * the partial unique index rather than by this function noticing.
 *
 * ## Why the row records no address
 *
 * `address` is the column {@link resolveConversationFrom} reads FIRST and the
 * column `channel_accounts_sending_address_uq` is built over, so writing the
 * platform address into it costs three things and buys none: the row falls under
 * a second unique index (a workspace that had registered that same address as a
 * sending identity could then never gain a front door at all, and the failure is
 * a swallowed conflict rather than an error); a stored address permanently
 * shadows the customer's own verified `support@…` in the From chain; and a value
 * minted once goes stale the day the install's mint domain moves. The address is
 * derived on both sides instead — inbound from the recipient's own label,
 * outbound as the last resort of the From chain — so it is always the address
 * this process would recognise today, and it never outranks configuration.
 *
 * Returns the existing route untouched when there is one, whatever address it
 * names. A workspace that forwards its own inbox in has one front door, not two,
 * and the address it forwards FROM is configuration a person typed. A route that
 * was soft-deleted is not one, and the default comes back on the next message:
 * the platform address is what the workspace HAS rather than something it opted
 * into, so the alternative is a workspace that has silently stopped answering on
 * the address it publishes.
 */
export async function ensurePlatformInboundRoute(
  recipients: string[]
): Promise<ChannelAccount | null> {
  if (!addressesPlatformInbox(recipients)) return null

  const owningTeamId = await defaultTeamId()
  if (!owningTeamId) {
    // Named without the recipient, which is a person's address. The workspace is
    // the thing that is misconfigured and the thing an operator can act on.
    log.warn(
      { reason: 'no_default_team' },
      'platform inbound route not created: the workspace has no default team'
    )
    return null
  }

  const existing = await getInboundRoute(owningTeamId)
  if (existing) return existing

  const [created] = await db
    .insert(channelAccounts)
    .values({ owningTeamId, role: 'inbound', config: { provider: await inboundProvider() } })
    // The conflict is named, not left open. An untargeted DO NOTHING swallows
    // EVERY unique violation this table can raise, so a constraint nobody had in
    // mind turns into a null return, a dropped message and no log line; naming
    // the one this insert can legitimately lose to means anything else still
    // throws where it can be seen.
    .onConflictDoNothing({
      target: channelAccounts.owningTeamId,
      where: sql`role = 'inbound' AND channel = 'email' AND deleted_at IS NULL`,
    })
    .returning()
  if (created) return created

  // Two deliveries can race here. The loser inserts nothing and reads the
  // winner's row, so both messages bind to one front door.
  const raced = await getInboundRoute(owningTeamId)
  if (!raced) {
    // Neither inserted nor found: the row the conflict named is there but
    // invisible to the read, which is a contradiction rather than a state to
    // handle. Silence here was the whole cost of the original defect, so it
    // leaves a trace even though the caller's answer is the same drop.
    log.warn(
      { reason: 'inbound_route_unavailable' },
      'platform inbound route could not be created or read'
    )
  }
  return raced
}

/**
 * Point the workspace's inbound route at the address a customer forwards mail
 * from, creating the route when it has none.
 *
 * An update rather than a second insert because a workspace has ONE front door
 * (the partial unique index says so), and by the time a person configures
 * forwarding the platform default may already have materialised. Forwarding
 * narrows nothing: the platform address is derived rather than stored, so it
 * keeps being recognised, and the address a person typed here is the one a reply
 * then leaves as.
 *
 * Stored folded, in the one spelling {@link resolveChannelAccountByRecipient}
 * looks it up by. That resolver folds the recipients it is handed and compares
 * them in SQL against this value as it stands, so a target saved the way a
 * person's mail client displays it (`Support@Acme.com`) would be a front door
 * that matches nothing.
 */
export async function setInboundForwardingTarget(input: {
  owningTeamId: TeamId
  forwardingTarget: string
}): Promise<ChannelAccount> {
  const provider = await inboundProvider()
  const forwardingTarget = input.forwardingTarget.trim().toLowerCase()
  const existing = await getInboundRoute(input.owningTeamId)
  if (!existing) {
    return createInboundRoute({
      owningTeamId: input.owningTeamId,
      config: { forwardingTarget, provider },
    })
  }
  const [row] = await db
    .update(channelAccounts)
    .set({
      config: { ...existing.config, forwardingTarget, provider },
      updatedAt: new Date(),
    })
    .where(eq(channelAccounts.id, existing.id))
    .returning()
  return row
}

/** Thrown when an address a workspace already uses for something else is added
 *  as a sending identity. Readable, because the only caller is a person who
 *  typed it into a settings form. */
export class ChannelAddressInUseError extends Error {
  constructor(readonly address: string) {
    super(`${address} is already in use by this workspace's inbound route.`)
    this.name = 'ChannelAddressInUseError'
  }
}

/**
 * A verified sending address for a module (the outbound From identity).
 *
 * `channel_accounts_sending_address_uq` covers (team, channel, address) and does
 * NOT include the module, so an address a workspace already holds cannot simply
 * be inserted again for a second module: that is a 23505, and unhandled it
 * reaches a person as a 500 from a settings button. Re-adding an address MOVES
 * it, which is both the readable outcome and an idempotent one — a double
 * submit, or a person changing their mind about which module answers from an
 * address, both land where they meant to.
 *
 * `setWhere` keeps the update to `sending` rows. The index spans roles, so a
 * workspace whose inbound route was configured by hand to name this address
 * would otherwise have its front door quietly rewritten into a From identity;
 * no row comes back from that branch, and it is refused out loud instead.
 */
export async function createSendingAddress(input: {
  owningTeamId: TeamId
  address: string
  module: SendingModule
  sendingDomainId?: SendingDomainId
  config?: ChannelAccountConfig
}): Promise<ChannelAccount> {
  const address = input.address.trim().toLowerCase()
  const [row] = await db
    .insert(channelAccounts)
    .values({
      owningTeamId: input.owningTeamId,
      role: 'sending',
      address,
      module: input.module,
      sendingDomainId: input.sendingDomainId ?? null,
      config: input.config ?? {},
    })
    .onConflictDoUpdate({
      target: [channelAccounts.owningTeamId, channelAccounts.channel, channelAccounts.address],
      targetWhere: sql`address IS NOT NULL AND deleted_at IS NULL`,
      set: {
        module: input.module,
        sendingDomainId: input.sendingDomainId ?? null,
        config: input.config ?? {},
        updatedAt: new Date(),
      },
      setWhere: eq(channelAccounts.role, 'sending'),
    })
    .returning()
  if (!row) throw new ChannelAddressInUseError(address)
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
/**
 * RFC 5322 display-name wrapper for a resolved sending address:
 * `"Alex (Acme)" <support@acme.com>`. Does not change address resolution.
 */
export function formatNamedSendingAddress(
  address: SendingIdentity,
  displayName: string
): SendingIdentity {
  return withSendingDisplayName(address, displayName)
}

export async function resolveSendingAddress(
  assignedTeamId: TeamId | null,
  module: SendingModule = 'support'
): Promise<SendingIdentity | null> {
  const teamId = assignedTeamId ?? (await defaultTeamId())
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
 * Falls back, in order, to the team's configured sending address for the module,
 * then to the workspace's own platform address, then to null, which the caller
 * reads as the branded workspace default. Each candidate is guarded
 * independently: an unverified inbox address must not suppress a verified team
 * address that would have been fine.
 *
 * The platform address is DERIVED here rather than read off the route row, and
 * it is LAST. Derived, because an install's mint domain can move under a row
 * written months ago, and a From on a domain that has been retired from minting
 * has no verified identity behind it — the reply then leaves as the platform
 * default with a refusal logged per message. Last, because it is the address a
 * workspace has rather than one it chose: a customer who verified their own
 * domain and forwards `support@theircompany.com` in must not have the thread
 * answered from the platform's shared domain instead.
 *
 * Only for a conversation that arrived through a front door. A thread with no
 * channel account is a widget conversation, and its notifications go out from
 * the branded workspace default they always have.
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

  const configured = await resolveSendingAddress(conv?.assignedTeamId ?? null, module)
  if (configured) return configured

  if (!conv?.channelAccountId) return null
  return permittedSendingIdentity(platformInboxAddress(currentMailSlug()))
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
 *
 * MATCHES ON ADDRESS ALONE AND SAYS NOTHING ABOUT ROLE. `address` is a column
 * both roles may carry — a person can point an inbound route at an address that
 * is also a From identity — so a caller that treats a match as a front door has
 * to check `role` itself. Cold inbound does exactly that: mail to a `sending`
 * row is mail to an identity we send AS, not to an inbox we receive at.
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
