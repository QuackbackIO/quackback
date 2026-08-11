/**
 * Inbound email channel config + plus-address routing, kept pure so it's
 * unit-tested directly. Outbound agent-reply emails set a conversation-specific
 * Reply-To; the inbound front door reads that plus-address back to route a reply
 * into the right conversation.
 *
 * ## The grammar
 *
 * ```
 *   support / cold inbound    <slug>@<domain>
 *   conversation reply        <slug>+c<id-suffix>.<tag>@<domain>
 *   ticket reply              <slug>+t<id-suffix>.<tag>@<domain>
 * ```
 *
 * `<slug>` is the workspace's mail slug, and it is in the address because one
 * inbound domain can serve an entire fleet. Conversation and ticket ids live in
 * per-workspace databases, so an address that names only an id cannot be
 * resolved by anything that does not already know which workspace to ask; the
 * slug is what a front door in front of many workspaces routes on. It is
 * supplied by the caller rather than derived here, because what identifies a
 * workspace to a mail server is a shorter and stricter thing than what
 * identifies it to the rest of the system — see {@link MAX_MAIL_SLUG_LENGTH}.
 *
 * There is exactly one reading of an address. A caller with no slug to give gets
 * no address at all rather than an unslugged variant: the send then goes out
 * without a Reply-To and the email footer points at the portal thread, which is
 * the behaviour every caller already has for an unconfigured inbound channel.
 *
 * `<tag>` is an HMAC over the slug AND the id together, so a third party who
 * received one of our reply emails cannot forge a reply-to for an arbitrary
 * conversation and inject messages as another visitor. Both halves are signed
 * because the secret is fleet-wide: a tag over the id alone would still verify
 * after the slug beside it was rewritten, which would make one leaked reply
 * address a fleet-wide capability wearing a workspace-shaped label. A transport
 * signature only proves the mail was forwarded to us, never the SMTP sender's
 * identity, which is why the address has to carry its own proof. The marker
 * character (`c` / `t`) is what keeps the two families from being read as one
 * another.
 *
 * Only the TypeID suffix is embedded, not the full `conversation_<suffix>` id:
 * the prefix is constant, so carrying it would burn 13 characters of the RFC
 * 5321 64-char local-part budget for no routing value. The parser re-attaches
 * it. The HMAC is still taken over the full id.
 *
 * ## The budget
 *
 * RFC 5321 caps a local part at {@link MAX_LOCAL_PART_LENGTH}. Everything after
 * the slug spends 51 of them (`+`, marker, 26-char TypeID suffix, `.`, 22-char
 * tag), which is what leaves the slug 13 and no more — {@link MAX_MAIL_SLUG_LENGTH}
 * is that subtraction rather than a number that has to be kept in step by hand.
 * Over the ceiling and the address is one a receiving mail server is entitled to
 * reject, so minting refuses.
 *
 * ## Mail sent before a workspace had a mail slug
 *
 * A reply to one of those does not route by address: the address it is replying
 * to names no workspace and carries no tag this module can check. It still
 * routes when the reply quotes a Message-ID recorded against the conversation,
 * which is the fallback the ingest core tries next (In-Reply-To / References).
 * When neither matches, the mail is cold inbound — it opens a new conversation
 * from the sender's address instead of appending to the old thread. The ticket
 * family has no Message-ID fallback of its own, so a reply to a pre-slug ticket
 * notification always lands as a new conversation.
 *
 * That is the designed behaviour of a grammar with one reading, not a gap in it.
 * An address whose workspace cannot be named is not routable by a front door
 * standing in front of many workspaces, and the alternative to declining is
 * guessing which workspace's data to write a stranger's mail into.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { ID_PREFIXES, type ConversationId, type TicketId } from '@quackback/ids'
import { extractEmailAddress } from './conversation.email-inbound'

type EnvLike = Record<string, string | undefined>

const INBOUND_DOMAIN_ENV = 'EMAIL_INBOUND_DOMAIN'
const INBOUND_SECRET_ENV = 'EMAIL_INBOUND_SIGNING_SECRET'
const EMAIL_FROM_ENV = 'EMAIL_FROM'

// `conversation_` / `ticket_` — the constant TypeID prefixes stripped from the
// local part on the way out and re-attached on the way in.
const CONVERSATION_PREFIX = `${ID_PREFIXES.conversation}_`
const TICKET_PREFIX = `${ID_PREFIXES.ticket}_`

/** The one character after `+` that says which family an address belongs to. */
const CONVERSATION_MARKER = 'c'
const TICKET_MARKER = 't'

// base64url chars of the HMAC-SHA256 tag embedded in the plus-address. 22
// (~132 bits) is far beyond what is needed to make the id unforgeable, and it
// is what the local-part budget below is computed against (#293).
const SIG_LEN = 22

/** A full-length tag, for the shape tests that run before any secret is read. */
const SIG_RE = new RegExp(`^[A-Za-z0-9_-]{${SIG_LEN}}$`)

/** Characters in the base32 suffix of a TypeID (a UUIDv7, encoded). */
const TYPEID_SUFFIX_LENGTH = 26

/** RFC 5321's ceiling on a local part, and the source of every other size here. */
const MAX_LOCAL_PART_LENGTH = 64

/** What an address spends on everything but the slug: `+`, the marker, the
 *  TypeID suffix, the `.` separator, and the tag. */
const NON_SLUG_LOCAL_PART_LENGTH = 1 + 1 + TYPEID_SUFFIX_LENGTH + 1 + SIG_LEN

/** Longest workspace slug the local-part budget leaves room for. Derived, so
 *  the ceiling cannot drift away from the grammar that consumes it. */
export const MAX_MAIL_SLUG_LENGTH = MAX_LOCAL_PART_LENGTH - NON_SLUG_LOCAL_PART_LENGTH

/**
 * A workspace slug that can appear in an address local part.
 *
 * Lower-case, digits and hyphen only: the local part is compared
 * case-insensitively by receiving servers, so an upper-case slug would round
 * trip as a different string, and anything outside this set would need quoting.
 */
const MAIL_SLUG_RE = new RegExp(`^[a-z0-9-]{1,${MAX_MAIL_SLUG_LENGTH}}$`)

/** Is this workspace key usable as the slug of an inbound address? */
export function isValidMailSlug(slug: string): boolean {
  return MAIL_SLUG_RE.test(slug)
}

/**
 * Thrown when a workspace key cannot be spent in an address local part.
 *
 * Loud on purpose. The quiet alternative is emitting an over-length or
 * unquotable local part, which a receiving mail server is entitled to reject —
 * so the failure would surface as mail that silently stops arriving, attributed
 * to anything but the address that caused it. A key that violates the rule is a
 * provisioning defect, and it is cheaper to find it on the first send.
 */
export class InvalidMailSlugError extends Error {
  constructor(readonly slug: string) {
    super(
      `Workspace mail slug ${JSON.stringify(slug)} is not usable in an email address: ` +
        `it must match ${MAIL_SLUG_RE.source}`
    )
    this.name = 'InvalidMailSlugError'
  }
}

/**
 * Thrown when the id side of an address cannot be spent in a local part.
 *
 * The branded id types make both cases unreachable from well-formed callers,
 * which is the reason this is one comparison each rather than a redesign: an id
 * that does not carry its constant prefix would be mangled by the slice that
 * removes it, and an id whose suffix is longer than a TypeID's would push the
 * local part past the RFC 5321 ceiling. Either produces an address that
 * verifies against nothing, i.e. mail that silently stops arriving.
 */
export class InvalidInboundAddressError extends Error {
  constructor(detail: string) {
    super(`Cannot mint an inbound email address: ${detail}`)
    this.name = 'InvalidInboundAddressError'
  }
}

function assertMailSlug(slug: string): string {
  if (!isValidMailSlug(slug)) throw new InvalidMailSlugError(slug)
  return slug
}

/** The bare TypeID suffix of a prefixed id — asserted, not assumed. */
function idSuffix(id: string, prefix: string): string {
  if (!id.startsWith(prefix)) {
    throw new InvalidInboundAddressError(
      `id ${JSON.stringify(id)} does not carry the ${JSON.stringify(prefix)} prefix`
    )
  }
  return id.slice(prefix.length)
}

/** Decode the `whsec_<base64>` signing secret to raw key bytes, or null. */
function signingKey(env: EnvLike): Buffer | null {
  const secret = env[INBOUND_SECRET_ENV]
  if (!secret) return null
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  return key.byteLength > 0 ? key : null
}

/**
 * Is the addressing half of inbound email usable — a domain to receive on and
 * the secret that makes an address unforgeable? When false, no routable Reply-To
 * is emitted and the provider webhook front door 404s.
 *
 * It is not the gate on every transport. Each front door authenticates its own
 * caller with its own credential and answers for its own configuration: the
 * provider webhook on this secret, the raw-MIME front door on the key its edge
 * sender holds, the mailbox poller on the mailbox credentials it is given. What
 * this answers is the question they share — whether an address minted here can
 * be read back — which is why it, and not any transport's gate, decides whether
 * a Reply-To goes out.
 *
 * Both values are process-level, and on a fleet that means fleet-wide: one
 * inbound domain and one signing secret serve every workspace behind the same
 * front door. What makes an address belong to a workspace is the slug in its
 * local part, not the secret it is signed with — and because the slug is inside
 * the signed message, a fleet-wide key still cannot be used to move an id from
 * one workspace's addresses to another's.
 */
export function isEmailInboundConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env[INBOUND_DOMAIN_ENV] && env[INBOUND_SECRET_ENV])
}

/**
 * HMAC tag binding a (workspace slug, id) PAIR to the inbound secret, or null
 * when no secret is configured.
 *
 * The pair rather than the id alone, because the secret is fleet-wide and a tag
 * that covered only the id would keep verifying beside any slug. NUL separates
 * the two: neither a mail slug (lower-case letters, digits, hyphen) nor a
 * TypeID can contain it, so exactly one pair produces any given signed message
 * and no two pairs can be run together into a third.
 *
 * Taken over the FULL prefixed id, so a conversation id and a ticket id never
 * produce a colliding tag — which is why the two address families route
 * unambiguously even before the marker character is read.
 */
function signInboundTag(slug: string, id: string, env: EnvLike): string | null {
  const key = signingKey(env)
  if (!key) return null
  return createHmac('sha256', key).update(`${slug}\0${id}`).digest('base64url').slice(0, SIG_LEN)
}

/** HMAC tag binding a conversation id to one workspace and the inbound secret,
 *  or null when no secret is configured. */
export function signConversationId(
  conversationId: string,
  slug: string,
  env: EnvLike = process.env
): string | null {
  return signInboundTag(slug, conversationId, env)
}

/** HMAC tag binding a ticket id to one workspace and the inbound secret. */
export function signTicketId(
  ticketId: string,
  slug: string,
  env: EnvLike = process.env
): string | null {
  return signInboundTag(slug, ticketId, env)
}

// ============================================================================
// Minting an address. Shared by both families, because both families are one
// grammar with one character changed.
// ============================================================================

/** `<slug>+<marker><id-suffix>.<tag>@<inbound-domain>`, or null when there is
 *  no slug, no inbound domain, or no signing secret. */
function inboundAddress(
  id: string,
  prefix: string,
  marker: string,
  slug: string | null,
  env: EnvLike
): string | null {
  // No slug, no address: on a shared front door an unslugged local part names
  // no workspace, so there is nothing to mint rather than something to fall
  // back to. Validated before the configuration is read so a malformed slug is
  // just as loud on an install that has not finished wiring inbound email.
  if (slug === null) return null
  const safeSlug = assertMailSlug(slug)

  const domain = env[INBOUND_DOMAIN_ENV]
  const sig = signInboundTag(safeSlug, id, env)
  if (!domain || !sig) return null

  const local = `${safeSlug}+${marker}${idSuffix(id, prefix)}.${sig}`
  if (local.length > MAX_LOCAL_PART_LENGTH) {
    throw new InvalidInboundAddressError(
      `local part is ${local.length} characters, over the RFC 5321 limit of ${MAX_LOCAL_PART_LENGTH}`
    )
  }
  return `${local}@${domain}`
}

// ============================================================================
// Reading an address back. Shared by both families for the same reason.
// ============================================================================

// An addr-spec anywhere in the value: a bare address, one wrapped in a display
// name, or one of several in a header. Case is preserved deliberately — the
// signature is base64url and lower-casing it would fail every verification.
const ADDR_SPEC_RE = /[^\s<>,;"]+@[^\s<>,;"]+/g

/** Every local part in the value, in order of appearance. */
function localParts(address: string): string[] {
  return (address.match(ADDR_SPEC_RE) ?? []).map((addr) => addr.slice(0, addr.lastIndexOf('@')))
}

/** One reading of a local part: what it claims, and the proof it offers. */
interface AddressClaim {
  /** The workspace the address names, lower-cased as it was minted. */
  slug: string
  /** The bare TypeID suffix the address embedded. */
  suffix: string
  /** The full prefixed id that suffix names. */
  id: string
  /** The tag the address offers as proof of that pair. */
  provided: string
}

/**
 * What a local part claims under this grammar, or null when it claims nothing.
 *
 * The suffix and the tag are both dot-free (TypeID base32 and base64url), so
 * the last dot is an unambiguous separator. Nothing here proves anything: a
 * claim is only a reading, and it takes {@link claimVerifies} to turn one into a
 * routing decision.
 */
function claimFor(local: string, marker: string, prefix: string): AddressClaim | null {
  const plus = local.indexOf('+')
  if (plus === -1) return null
  // A local part whose label is not a usable slug names no workspace we could
  // ever have minted for, so it has no reading at all — not a reading that
  // happens to fail verification.
  const slug = local.slice(0, plus).toLowerCase()
  if (!isValidMailSlug(slug)) return null

  const rest = local.slice(plus + 1)
  if (!rest.startsWith(marker)) return null
  const body = rest.slice(marker.length)
  const dot = body.lastIndexOf('.')
  if (dot <= 0) return null

  const suffix = body.slice(0, dot)
  return { slug, suffix, id: `${prefix}${suffix}`, provided: body.slice(dot + 1) }
}

/**
 * Does this claim have the exact shape this module mints?
 *
 * Secret-free, so it can be asked before anything is verified. Length is the
 * whole test precisely because everything shorter is ordinary sub-addressing:
 * customers plus-address a support address for their own filing, and
 * `<slug>+tuesday@` or `<slug>+twitter.com@` must never be mistaken for a
 * mangled ticket reply.
 */
function isMintedShape(claim: AddressClaim): boolean {
  return claim.suffix.length === TYPEID_SUFFIX_LENGTH && SIG_RE.test(claim.provided)
}

/** Constant-time tag check on one claim, against the pair it claims. */
function claimVerifies(claim: AddressClaim, env: EnvLike): boolean {
  const expected = signInboundTag(claim.slug, claim.id, env)
  if (!expected) return false
  const a = Buffer.from(claim.provided)
  const b = Buffer.from(expected)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

/** The verified id carried by any address in `value`, or null.
 *
 *  Verification is the only gate: {@link isMintedShape} is deliberately NOT
 *  applied here, because the tag is strictly the stronger test and adding a
 *  second one would give the two paths a way to disagree. */
function verifiedIdFrom(
  value: string,
  marker: string,
  prefix: string,
  env: EnvLike
): string | null {
  for (const local of localParts(value)) {
    const claim = claimFor(local, marker, prefix)
    if (claim && claimVerifies(claim, env)) return claim.id
  }
  return null
}

/**
 * What workspace an inbound address names, in the two states a local part can
 * be in. The routing label a shared front door reads before it knows anything
 * else about the mail.
 *
 * The states are distinct on purpose and a caller must decide both explicitly.
 * `unreadable` is never "no workspace named, so allow": it is a local part this
 * grammar cannot mint, which on a shared inbound domain is either a stranger's
 * address or an attempt at one, and a rule shaped "reject when the slug is not
 * ours" would wave through exactly those if they collapsed into one absent
 * value alongside the legitimate readings.
 */
export type InboundAddressWorkspace = { kind: 'slug'; slug: string } | { kind: 'unreadable' }

/**
 * Read the workspace label out of an inbound address: everything left of `+`,
 * or the whole local part on a bare `<slug>@<domain>` support address.
 *
 * Pass ONE address — the one the mail was DELIVERED to (the envelope
 * recipient) — not a whole `To` header. A header carries other people's
 * addresses, and a stranger's local part can be slug-shaped too, so nothing here
 * could tell which of several labels is ours.
 *
 * The reading is character-for-character the one the edge reader applies before
 * it chooses which workspace host to hand a message to: split on the LAST `@`
 * (so a quoted local part containing one cannot move the boundary), trim, fold
 * case, take everything before the first `+`. Two readers that normalised
 * differently could disagree about whose mail a message is, and the whole point
 * of the label is that they cannot. Anything that does not then match the slug
 * vocabulary is `unreadable`, including an address with no `@` and one with an
 * empty local part.
 *
 * The two halves of the `at <= 0` guard are not equally load-bearing, and the
 * suite says which is which rather than implying both. `at === -1` IS: without
 * it `slice(0, -1)` would read a value with no `@` as its own local part minus
 * the last character, so `neon-t1x` would answer `neon-t1` and a bare word would
 * name a workspace. `at === 0` is belt and braces: an empty local part is
 * already outside the slug vocabulary, so removing that half changes no answer,
 * and what pins it is the vocabulary test rather than a case here.
 */
export function workspaceSlugFromInboundAddress(address: string): InboundAddressWorkspace {
  const at = address.lastIndexOf('@')
  if (at <= 0) return { kind: 'unreadable' }
  const local = address.slice(0, at).trim().toLowerCase()
  const slug = local.split('+')[0] ?? ''
  return isValidMailSlug(slug) ? { kind: 'slug', slug } : { kind: 'unreadable' }
}

/** `<slug>+c<id-suffix>.<tag>@<inbound-domain>`. Null when the caller has no
 *  mail slug for the workspace, or when the inbound domain or signing secret is
 *  missing — the caller then sends without a Reply-To and the email footer
 *  points at the portal thread instead. The `conversation_` prefix is dropped to
 *  keep the local part under the RFC 5321 64-char limit (#293). */
export function inboundReplyToAddress(
  conversationId: ConversationId,
  slug: string | null,
  env: EnvLike = process.env
): string | null {
  return inboundAddress(conversationId, CONVERSATION_PREFIX, CONVERSATION_MARKER, slug, env)
}

/** Extract + verify the conversation id from a `<slug>+c<id-suffix>.<tag>@domain`
 *  recipient. Returns the id only when the tag matches the (slug, id) pair
 *  (constant-time); an unsigned, tampered, re-slugged or wrong-secret address
 *  yields null so a forged reply-to can't route into someone else's
 *  conversation. */
export function conversationIdFromInboundAddress(
  address: string,
  env: EnvLike = process.env
): string | null {
  return verifiedIdFrom(address, CONVERSATION_MARKER, CONVERSATION_PREFIX, env)
}

// ============================================================================
// Outbound Message-ID threading. Every notification email carries a
// deterministic Message-ID whose host is one of our own sending domains and
// whose local part embeds the conversation suffix (for debuggability) plus a
// nonce (uniqueness across a thread). Routing back is by exact match against
// the stored ids (see conversation.email-store.ts), not by parsing this — the
// store is the authority, so no signature is needed on the id itself.
// ============================================================================

/** The domain part of an `addr` or `Name <addr>` value, lower-cased. Reuses the
 *  inbound address parser (a single plausible addr-spec) and takes its host. */
function domainOf(address: string | undefined): string | null {
  const email = extractEmailAddress(address ?? null)
  return email ? email.slice(email.lastIndexOf('@') + 1) : null
}

/** The host used for outbound Message-IDs: the sending identity's domain, else
 *  the inbound domain. Null when neither is configured (no threading). */
export function outboundMessageIdDomain(env: EnvLike = process.env): string | null {
  return domainOf(env[EMAIL_FROM_ENV]) ?? env[INBOUND_DOMAIN_ENV] ?? null
}

/** Domains we send from — an inbound message whose Message-ID sits on one of
 *  these is our own mail looping back, so the ingest core drops it. */
export function ownEmailDomains(env: EnvLike = process.env): Set<string> {
  const domains = new Set<string>()
  const from = domainOf(env[EMAIL_FROM_ENV])
  if (from) domains.add(from)
  const inbound = env[INBOUND_DOMAIN_ENV]?.toLowerCase()
  if (inbound) domains.add(inbound)
  return domains
}

/** Mint a fresh outbound Message-ID for a conversation, bare (no angle
 *  brackets — the send layer wraps it). Null when no sending domain is known. */
export function mintOutboundMessageId(
  conversationId: ConversationId,
  env: EnvLike = process.env
): string | null {
  const domain = outboundMessageIdDomain(env)
  if (!domain) return null
  const nonce = randomBytes(9).toString('base64url')
  return `c.${idSuffix(conversationId, CONVERSATION_PREFIX)}.${nonce}@${domain}`
}

// ============================================================================
// Internal-note threading. An @-mention alert is agent-facing mail about a
// conversation, so it threads on its own `note.` namespace rather than the
// customer-facing `c.` ids above. The two namespaces are disjoint by
// construction, which is what keeps an internal note out of the thread the
// customer sees — and keeps a note alert unroutable by the inbound map, whose
// authority is the recorded `c.` ids alone.
// ============================================================================

/** Deterministic Message-ID for a conversation's internal-note email thread
 *  root: every note alert References this id, so repeated mentions on one
 *  conversation collapse into a single thread in the teammate's client.
 *  Stateless (derived from the conversation id). Null when no sending domain is
 *  known, in which case the alert threads on nothing. */
export function noteThreadRootMessageId(
  conversationId: ConversationId,
  env: EnvLike = process.env
): string | null {
  const domain = outboundMessageIdDomain(env)
  if (!domain) return null
  return `note.${idSuffix(conversationId, CONVERSATION_PREFIX)}@${domain}`
}

/** Fresh per-send Message-ID for an internal-note alert, bare (no angle
 *  brackets — the send layer wraps it). Unique per recipient and per send, so
 *  no two alerts claim the same id. */
export function mintNoteOutboundMessageId(
  conversationId: ConversationId,
  env: EnvLike = process.env
): string | null {
  const domain = outboundMessageIdDomain(env)
  if (!domain) return null
  const nonce = randomBytes(6).toString('base64url')
  return `note.${idSuffix(conversationId, CONVERSATION_PREFIX)}.${nonce}@${domain}`
}

// ============================================================================
// Ticket reply-to addressing. Same grammar and signing secret as the
// conversation addresses above, with a `t` marker where those carry `c`:
// `<slug>+t<id-suffix>.<tag>@<inbound-domain>`. A ticket address fed to the
// conversation parser produces no claim at all — the marker it needs is not
// there — and vice versa, so misrouting is structurally impossible rather than
// merely improbable. This module stays the single owner of the grammar.
// ============================================================================

/** `<slug>+t<id-suffix>.<tag>@<inbound-domain>`. Null when the caller has no
 *  mail slug for the workspace, or when inbound email is not configured — the
 *  caller then sends without a Reply-To and the email footer points at the
 *  portal thread instead. */
export function inboundTicketReplyToAddress(
  ticketId: TicketId,
  slug: string | null,
  env: EnvLike = process.env
): string | null {
  return inboundAddress(ticketId, TICKET_PREFIX, TICKET_MARKER, slug, env)
}

/** Extract + verify the ticket id from a `<slug>+t<id-suffix>.<tag>@domain`
 *  recipient. Constant-time tag check over the (slug, id) pair; a tampered,
 *  re-slugged or wrong-secret address yields null so a forged reply-to can't
 *  inject into a ticket. */
export function ticketIdFromInboundAddress(
  address: string,
  env: EnvLike = process.env
): string | null {
  return verifiedIdFrom(address, TICKET_MARKER, TICKET_PREFIX, env)
}

/**
 * Does this recipient CLAIM to be ticket-destined, verified or not?
 *
 * The ingest core routes on this before it checks any tag, so that a forged or
 * tampered ticket address is dropped rather than falling through to be
 * reinterpreted as a conversation reply or opened as a fresh cold-inbound
 * conversation. Claiming has to be decidable without the secret, so it is the
 * shape that decides — and it has to be the WHOLE shape.
 *
 * A test that only looked at the marker character would claim any sub-address
 * beginning with a `t`, and customers plus-address a support address for their
 * own filing all the time. Claiming one of those drops a real customer's mail
 * before conversation routing ever sees it, which is a far worse failure than
 * the one this predicate exists to prevent. So the body after the marker must
 * split into a full-length TypeID suffix and a full-length tag, either side of
 * the final dot — the exact shape {@link inboundTicketReplyToAddress} mints and
 * nothing else.
 */
export function bearsTicketMarker(address: string): boolean {
  for (const local of localParts(address)) {
    const claim = claimFor(local, TICKET_MARKER, TICKET_PREFIX)
    if (claim && isMintedShape(claim)) return true
  }
  return false
}

/** Deterministic Message-ID for a ticket's email-thread ROOT: every ticket
 *  email References this id, so a ticket's notifications collapse into one
 *  client conversation. Stateless (derived from the ticket id); the received
 *  confirmation carries it as its own Message-ID, later sends mint fresh ids
 *  via mintTicketOutboundMessageId and Reference this. */
export function ticketRootMessageId(ticketId: TicketId, env: EnvLike = process.env): string | null {
  const domain = outboundMessageIdDomain(env)
  if (!domain) return null
  return `ticket-${idSuffix(ticketId, TICKET_PREFIX)}@${domain}`
}

/** Fresh per-send Message-ID for a ticket email (non-root sends). */
export function mintTicketOutboundMessageId(
  ticketId: TicketId,
  env: EnvLike = process.env
): string | null {
  const domain = outboundMessageIdDomain(env)
  if (!domain) return null
  const nonce = randomBytes(6).toString('base64url')
  return `ticket-${idSuffix(ticketId, TICKET_PREFIX)}.${nonce}@${domain}`
}
