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
import { normalizeMailDomain } from '@/lib/server/utils/mail-domain'
import { isPooledTenancy } from '@/lib/server/workspaces/mode'
import { extractEmailAddress } from './conversation.email-inbound'

type EnvLike = Record<string, string | undefined>

/**
 * The ONE domain every address minted here is built on.
 *
 * One domain, and the value has to be readable as one: see
 * {@link inboundMintDomain} for what happens to a value that is not.
 */
const INBOUND_DOMAIN_ENV = 'EMAIL_INBOUND_DOMAIN'

/**
 * Further domains this install RECEIVES on and never mints on. Comma- or
 * whitespace-separated; unset is the ordinary single-domain install.
 *
 * Two values rather than one list, because the two halves of a domain change
 * have different lifetimes. MINTING moves in a single step: from the moment
 * {@link INBOUND_DOMAIN_ENV} changes, every new reply address is on the new
 * domain and no address on the old one is ever produced again. ACCEPTING cannot
 * move at all. Every address ever minted is still sitting in somebody's mail
 * client and still routes a reply, so a domain that stops being accepted leaves
 * each of those arriving at a door that refuses it — mail nobody has, waiting on
 * a replay queue for somebody to notice — and that population only grows,
 * because a reply address is read months after it was sent.
 *
 * So the accept-set is the mint domain plus this list, and this list is only
 * ever added to. A domain change is then a swap of two values with both domains
 * inside the accept-set at every instant, rather than a window in which one of
 * them refuses mail. A single list with the first entry minting would make the
 * same change a REORDER, where a typo silently moves minting instead of
 * widening the door.
 *
 * The mint domain is deliberately NOT split on commas. It names one domain, and
 * an install that put a list there would mint addresses on a domain that does
 * not exist. One value, one meaning, in every reader — and a value that names
 * more than one is refused rather than half-understood; see
 * {@link inboundMintDomain}.
 *
 * ## What listing a domain here costs, and who pays it
 *
 * Membership is not free, and none of the three costs falls on the operator who
 * types it. Each is stated at the reader that imposes it; together they are the
 * rule for what may be listed at all: a zone this platform OPERATES, retired
 * from minting but still ours.
 *
 * 1. No customer may ever verify that zone, its subtree, or any zone ABOVE it as
 *    their own sending domain. The list only grows in practice, so the set of
 *    zones no customer may use grows with it — and the customer who is refused
 *    never sees why. See `platformSendingDomains`.
 * 2. On an install that serves ONE workspace, inbound mail whose `Message-ID`
 *    sits on it is suppressed as that workspace's own mail looping back, with
 *    nothing retained. A pooled fleet reads no host that way, since a shared
 *    host names no workspace. See {@link ownMessageIdDomains}.
 * 3. Nothing else. In particular it grants no workspace the right to SEND from
 *    the domain: that is a claim about a verified provider identity, which only
 *    the minting domain has, and the send guard asks for the minting domain
 *    alone.
 *
 * ## It has to survive a deploy
 *
 * The value is set out of band, and infrastructure-as-code that does not declare
 * this variable DELETES it on the next apply. That is not a cosmetic loss: the
 * accept-set narrows back to the minting domain, and every reply address on the
 * retired one starts being refused by a front door that no longer answers for
 * it. Declare it wherever fleet variables are declared, even when it is empty.
 */
const INBOUND_EXTRA_DOMAINS_ENV = 'EMAIL_INBOUND_EXTRA_DOMAINS'

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
  return Boolean(inboundMintDomain(env) && env[INBOUND_SECRET_ENV])
}

/**
 * Is the provider webhook's front door there at all?
 *
 * Deliberately NOT the question above, and the difference is one variable being
 * unusable rather than unset. That door 404s when it answers false, and a 404 to
 * a provider is a notification retried for a while and then abandoned — so the
 * message is lost on OUR side for a reason that has nothing to do with it.
 *
 * Ingesting is still the right answer there when the mint domain is unusable.
 * Nothing about routing an arriving message depends on that value: the recipient
 * is read from the message, and a reply with no plus-address still threads on
 * `In-Reply-To`/`References` or opens a cold conversation. What is lost is the
 * Reply-To on the way back out, which is exactly the degradation an install with
 * inbound email unconfigured already has, and it is a smaller loss than the mail
 * itself.
 *
 * So this asks what it always asked — a domain was configured, and the secret
 * that verifies this caller is present — and the stricter question is left to
 * the readers whose wrong answer is not a discarded message: minting, which
 * declines, the admin surface, which says so, and the raw-MIME door, which
 * DEFERS.
 */
export function isEmailInboundWebhookConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env[INBOUND_DOMAIN_ENV]?.trim() && env[INBOUND_SECRET_ENV])
}

/**
 * The domain every address minted here is built on, or null when this install
 * has none it can use.
 *
 * Null for absent, and null for a value that does not name one domain — which
 * is the whole reason this is a function rather than a read. A value naming
 * more than one, `a.example,b.example` being the typo this variable invites
 * during the very cutover the extras exist for, used to be spent verbatim in
 * both directions at once: an address minted `…@a.example,b.example`, which no
 * mail server will ever deliver a reply to, and an accept-set holding that one
 * string, which no envelope can ever match. Both halves silently wrong, and the
 * admin surface still reporting the channel configured.
 *
 * Refusing it here is what makes the same typo loud instead: nothing is minted,
 * {@link isEmailInboundConfigured} is false, the admin surface says so, and the
 * raw-MIME front door answers a delivery with a DEFERRAL rather than a
 * rejection — so the mail waits for the value to be corrected instead of
 * bouncing. See {@link invalidInboundDomainValues} for the operator-facing half.
 *
 * Normalised through the one function every other reader normalises through, so
 * a mistyped-but-usable spelling (padding, a trailing dot, an internationalised
 * domain in its unicode form) is the same domain everywhere it is read rather
 * than a repaired accept-set beside a malformed minted address.
 */
export function inboundMintDomain(env: EnvLike = process.env): string | null {
  return normalizeMailDomain(env[INBOUND_DOMAIN_ENV])
}

/** Every entry of the extras list, as configured, in one place. */
function extraDomainValues(env: EnvLike): string[] {
  // Comma or whitespace. A domain can contain neither, so no separator here can
  // be mistaken for part of a value.
  return (env[INBOUND_EXTRA_DOMAINS_ENV] ?? '').split(/[,\s]+/).filter((value) => value !== '')
}

/**
 * EVERY domain a delivery may name: the one addresses are minted on, plus the
 * ones this install still receives on and no longer mints on.
 *
 * Minting reads {@link inboundMintDomain} alone and always will. This is the
 * other half of the same fact, and the two are asymmetric on purpose: an address
 * is minted once and read for as long as the mail it travelled in survives, so
 * the set of domains that must be ANSWERED for is a superset of the one that is
 * minted on, and it only ever grows.
 *
 * Normalised entry by entry through {@link normalizeMailDomain}, which is the
 * same normalisation the minter, the outbound `Message-ID` host and the
 * provisioning refusal spend. That sameness is the property: a set folded by its
 * own local rule would answer for a spelling nothing else in the process used,
 * which is how a door comes to refuse the only spelling a real mail server
 * delivers. Unusable and empty entries are dropped, which is what makes a
 * trailing comma, a blank value and an unset value the same configuration —
 * and a dropped entry is reported, not swallowed, by
 * {@link invalidInboundDomainValues}.
 *
 * Exact matches only. A subdomain of an accepted domain is NOT accepted: the
 * workspace label is unique only inside the zone it was minted under, so a
 * second zone that resolved to the same host would make one label two
 * workspaces'.
 */
export function inboundAcceptDomains(env: EnvLike = process.env): Set<string> {
  const domains = new Set<string>()
  const mint = inboundMintDomain(env)
  if (mint) domains.add(mint)
  for (const extra of extraDomainValues(env)) {
    const domain = normalizeMailDomain(extra)
    if (domain) domains.add(domain)
  }
  return domains
}

/**
 * The configured values that name no domain, so somebody can be told.
 *
 * Every other reader treats an unusable value as absent, which is the safe
 * behaviour and a silent one: the install mints nothing and defers everything,
 * for a reason nothing on the mail path is able to state. This is the reason,
 * gathered purely so the process can say it out loud at boot — a typo in the
 * variable that carries a mail cutover is worth a line an operator can find.
 *
 * Names the VARIABLE and the value, because both are configuration an operator
 * typed. Neither is a secret and neither is a recipient.
 */
export function invalidInboundDomainValues(
  env: EnvLike = process.env
): Array<{ variable: string; value: string }> {
  const bad: Array<{ variable: string; value: string }> = []
  const mint = env[INBOUND_DOMAIN_ENV]
  // Blank is unset, not a typo: there is nothing to tell an operator about a
  // variable they have not filled in.
  if (mint?.trim() && !normalizeMailDomain(mint)) {
    bad.push({ variable: INBOUND_DOMAIN_ENV, value: mint })
  }
  for (const extra of extraDomainValues(env)) {
    if (!normalizeMailDomain(extra)) bad.push({ variable: INBOUND_EXTRA_DOMAINS_ENV, value: extra })
  }
  return bad
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

  // The normalised mint domain, never the raw value: an address is minted once
  // and read for months, so a spelling only this reader accepted would be a
  // reply address the front door does not answer for.
  const domain = inboundMintDomain(env)
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

/** Every addr-spec in the value, in order of appearance, split at the last `@`
 *  into the two halves the readers below ask about. */
function addrSpecs(value: string): Array<{ local: string; domain: string }> {
  return (value.match(ADDR_SPEC_RE) ?? []).map((addr) => {
    const at = addr.lastIndexOf('@')
    return { local: addr.slice(0, at), domain: addr.slice(at + 1) }
  })
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
  for (const { local } of addrSpecs(value)) {
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

// ============================================================================
// The platform inbox: the bare `<slug>@<domain>` address at the top of the
// grammar. Every workspace has one from the moment it exists, because both
// halves of it are already known — the label the front door routes on, and the
// domain this install mints on. Nothing has to be configured for it to be the
// workspace's address; what follows is only how to write it down and how to
// recognise it coming back.
// ============================================================================

/**
 * The workspace's own support address, or null when there is none to write.
 *
 * The MINTING domain, never an extra. An extra is a domain this install still
 * RECEIVES on and has no verified sending identity behind, so an address built
 * on one is a From the provider would refuse — see {@link INBOUND_EXTRA_DOMAINS_ENV}
 * for the whole of what membership does and does not grant.
 *
 * Null in both of the states that have no address rather than a broken one:
 *
 * - NO MAIL SLUG. On a shared front door an unslugged local part names no
 *   workspace, which is the same refusal {@link inboundAddress} makes and for the
 *   same reason. A malformed slug answers null here rather than throwing,
 *   because this is read on the path an arriving message takes: a throw there is
 *   a 5xx to a delivering mail server and a redelivery loop, where null is the
 *   mail declining to be recognised. The loud refusal still exists where a
 *   person is present to read it — minting an outbound reply address throws
 *   {@link InvalidMailSlugError} on the very same slug.
 * - NO USABLE MINT DOMAIN. {@link inboundMintDomain} refuses a value naming
 *   anything but one domain, and that refusal must not be papered over by
 *   inventing an address on a domain nothing can deliver to.
 */
export function platformInboxAddress(
  slug: string | null,
  env: EnvLike = process.env
): string | null {
  if (slug === null) return null
  const label = slug.trim().toLowerCase()
  if (!isValidMailSlug(label)) return null
  const domain = inboundMintDomain(env)
  return domain ? `${label}@${domain}` : null
}

/**
 * Was this recipient addressed to the workspace's platform inbox?
 *
 * The ACCEPT-set, where {@link platformInboxAddress} writes on the mint domain
 * alone, and the asymmetry is the same one the accept-set exists for: an address
 * is published once and written to for as long as anyone has it, so a customer
 * who saved the address before a domain change is still writing to this
 * workspace. Recognising that mail costs nothing — the workspace is already
 * identified by the label — while MINTING on the retired domain would produce a
 * From with no identity behind it.
 *
 * Sub-addresses count, because the label is what names the workspace and
 * everything after `+` is the sender's own filing. A `<slug>+c…`/`<slug>+t…`
 * address that reached this point is one whose tag did NOT verify, and treating
 * it as ordinary mail to the support address is what the grammar already says
 * happens to an address that resolves to no thread: a new conversation from the
 * sender, never an append to somebody else's.
 *
 * Reads addr-specs out of the value, like every other reader here, because that
 * is the form its callers are handed: both front doors take an address-list
 * ENTRY as it stood in the header, so `"Acme Support" <slug@domain>` is the
 * ordinary case and not an exotic one. Reading the value as a bare address
 * instead answered no for it and the mail was dropped — invisible behind the
 * signed-envelope door, which prepends the bare envelope recipient, and not
 * invisible at all over IMAP, which is a self-hosted install's whole inbound
 * channel.
 */
export function isPlatformInboxRecipient(
  value: string,
  slug: string | null,
  env: EnvLike = process.env
): boolean {
  if (slug === null) return false
  const label = slug.trim().toLowerCase()
  const accepted = inboundAcceptDomains(env)
  if (accepted.size === 0) return false

  for (const { local, domain } of addrSpecs(value)) {
    const host = normalizeMailDomain(domain)
    if (!host || !accepted.has(host)) continue
    // Re-joined and handed to the one reader of a workspace label, rather than
    // split again here: two readings of the same address that can drift is the
    // failure the shared reader exists to prevent.
    const claimed = workspaceSlugFromInboundAddress(`${local}@${domain}`)
    if (claimed.kind === 'slug' && claimed.slug === label) return true
  }
  return false
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

/**
 * The host used for outbound Message-IDs: the sending identity's domain, else
 * the minting domain. Null when neither is configured (no threading).
 *
 * Both sides normalised, so the host stamped into an id we mint is spelled the
 * way {@link ownEmailDomains} compares one coming back. An unusable value falls
 * through to the next candidate rather than becoming the host, which is what
 * keeps a mistyped `EMAIL_FROM` from emitting ids on a domain that does not
 * exist.
 */
export function outboundMessageIdDomain(env: EnvLike = process.env): string | null {
  return normalizeMailDomain(domainOf(env[EMAIL_FROM_ENV])) ?? inboundMintDomain(env)
}

/**
 * Domains this INSTALL sends and receives on.
 *
 * Every domain we RECEIVE on, not just the one we mint on. A notification sent
 * before a domain change carries a Message-ID on the domain that was minting
 * then, and it is no less the install's for having been retired since; a set
 * that had narrowed to the current mint domain would stop recognising exactly
 * the older mail most likely to still be circulating.
 *
 * A fact about the PROCESS, which is why it is not by itself an answer to "is
 * this message ours" — see {@link ownMessageIdDomains}, the only reader, for the
 * workspace half of that question.
 */
export function ownEmailDomains(env: EnvLike = process.env): Set<string> {
  const domains = inboundAcceptDomains(env)
  // Normalised like every member beside it: the comparison is against the
  // `Message-ID` domain of mail as it actually arrives, which is A-label ASCII.
  const from = normalizeMailDomain(domainOf(env[EMAIL_FROM_ENV]))
  if (from) domains.add(from)
  return domains
}

/**
 * The `Message-ID` hosts on which an id is evidence that THIS workspace sent the
 * message.
 *
 * The set the mail-loop guard's host test runs against, and it is narrower than
 * {@link ownEmailDomains} for the same reason a reply address has to carry a
 * workspace label: the branch it feeds is a suppression with nothing retained,
 * so every member is a promise that no OTHER sender's mail legitimately carries
 * a `Message-ID` there. "Other" includes the workspace next door.
 *
 * ONE WORKSPACE PER PROCESS — the install owns its domains outright. There is no
 * second workspace to be confused with, so every domain it operates is evidence
 * about it, and a self-hosted install keeps exactly the guard it has always had.
 *
 * POOLED — none of them. One fleet serves every workspace behind one sending
 * domain, so a host is a fact about the FLEET: the neighbour's notifications
 * wear the identical host, and reading it as authorship suppresses their mail
 * with no retention and nobody to notice. That is the same mistake as adopting a
 * sending provider's regional host, one level in. Two things answer the question
 * there instead, and neither is a domain: the id this workspace RECORDED going
 * out (exact, and the store owns it), and the reply address this workspace
 * minted, which carries its label under an HMAC tag ({@link isOwnInboundAddress}).
 *
 * Nothing is lost on the fleet by emptying it. Ids are minted at
 * {@link outboundMessageIdDomain} — the platform's own sending domain, shared —
 * and the fleet's transport replaces the header id anyway, so this test had no
 * true positive there to give up: every match it could make was somebody else's
 * mail.
 *
 * A SENDING PROVIDER'S OWN HOST IS THE ONE TO REFUSE, every time it is proposed
 * for either set. A provider that assigns the `Message-ID` itself puts its
 * regional host on our mail, so adding that host looks like it restores the
 * guard — and it instead promises the impossible: that host is on every
 * account's mail on that region, so the promise above breaks for every other
 * customer of the same provider.
 */
export function ownMessageIdDomains(env: EnvLike = process.env): Set<string> {
  return isPooledTenancy(env) ? new Set() : ownEmailDomains(env)
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
// Team-alert threading. Agent-facing mail about a visitor message, in its own
// `team.` namespace — disjoint from customer `c.` ids and internal `note.` ids
// so a teammate's alert thread never joins the customer's mailbox thread.
// ============================================================================

export function teamThreadRootMessageId(
  conversationId: ConversationId,
  env: EnvLike = process.env
): string | null {
  const domain = outboundMessageIdDomain(env)
  if (!domain) return null
  return `team.${idSuffix(conversationId, CONVERSATION_PREFIX)}@${domain}`
}

export function mintTeamOutboundMessageId(
  conversationId: ConversationId,
  env: EnvLike = process.env
): string | null {
  const domain = outboundMessageIdDomain(env)
  if (!domain) return null
  const nonce = randomBytes(6).toString('base64url')
  return `team.${idSuffix(conversationId, CONVERSATION_PREFIX)}.${nonce}@${domain}`
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
  for (const { local } of addrSpecs(address)) {
    const claim = claimFor(local, TICKET_MARKER, TICKET_PREFIX)
    if (claim && isMintedShape(claim)) return true
  }
  return false
}

/**
 * Did THIS workspace mint one of the addresses in this header value?
 *
 * The evidence the mail-loop guard runs on. It exists because authorship used to
 * be readable off a `Message-ID` — we minted the id, so its host was a domain we
 * operate — and a sending provider that assigns its own id ends that. The host
 * on the wire then belongs to the PROVIDER and is shared with every other
 * account on its region, so it is evidence of nothing: a guard keyed on it would
 * read any of that provider's customers' mail as our own and refuse it. That is
 * why this asks about an address we minted and not about the host an id happens
 * to wear.
 *
 * Three conditions, and dropping any one of them puts somebody else's mail
 * inside the answer:
 *
 * 1. THE TAG VERIFIES. Without it the answer is reachable by typing an address
 *    out, and the grammar is public.
 * 2. THE LABEL IS THIS WORKSPACE'S. The signing secret is fleet-wide, so a
 *    neighbouring workspace's address verifies against it perfectly. Their mail
 *    forwarded into this inbox is a stranger's mail here, and refusing it is the
 *    same mistake as trusting the provider's host, one level in.
 * 3. THE DOMAIN IS ONE WE RECEIVE ON. The tag covers the local part alone, so
 *    without this an address wearing our local part at any domain at all would
 *    answer yes.
 *
 * Both families, because both are mail we send and either can come back.
 *
 * What it does NOT prove is that the sender is us: anyone we have ever emailed
 * holds one of these addresses and can put it in a header. What it does prove is
 * the narrower thing the guard is entitled to act on: this is a message composed
 * against an address only this workspace could have minted.
 *
 * NOR DOES IT ASK WHICH conversation. Any minted address of this workspace
 * satisfies it, including one belonging to a thread this message has nothing to
 * do with — so anyone ever CC'd on one of our mails holds a value that answers
 * yes. Left that way deliberately, and the reason is what the caller does with
 * the answer: this signal RETAINS the message (files it to Spam under an
 * enumerated cause) rather than destroying it, so a wrong yes costs a thread in
 * a review queue instead of somebody's mail. Narrowing it would mean requiring
 * the message's own threading chain to resolve to the same conversation, which a
 * forwarder that strips `References` defeats and which buys nothing against the
 * cost that is actually left.
 */
export function isOwnInboundAddress(
  value: string,
  slug: string | null,
  env: EnvLike = process.env
): boolean {
  // No workspace label means no question to ask, so the answer is no and the
  // message is ingested. That is the direction to fail in: a wrong "not ours"
  // files one of our own mails into the inbox, where an agent sees it and closes
  // it, while a wrong "ours" files a customer's mail to Spam, where they wait on
  // a reply nobody knows they are owed.
  if (slug === null) return false
  const label = slug.trim().toLowerCase()
  const accepted = inboundAcceptDomains(env)
  if (accepted.size === 0) return false

  for (const { local, domain } of addrSpecs(value)) {
    const host = normalizeMailDomain(domain)
    if (!host || !accepted.has(host)) continue
    for (const [marker, prefix] of [
      [CONVERSATION_MARKER, CONVERSATION_PREFIX],
      [TICKET_MARKER, TICKET_PREFIX],
    ] as const) {
      const claim = claimFor(local, marker, prefix)
      if (claim && claim.slug === label && claimVerifies(claim, env)) return true
    }
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
