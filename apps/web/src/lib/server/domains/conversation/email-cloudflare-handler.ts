/**
 * The app's front door for mail delivered by the fleet's inbound Email Worker.
 *
 * Cloudflare Email Routing cannot post to an arbitrary HTTPS endpoint, so a
 * Worker sits between its MTA and this fleet: it normalises the workspace label
 * in the envelope recipient, resolves it to a hostname, and POSTs the raw
 * message here under an HMAC that covers the label it resolved. The wire
 * contract is fixed by that Worker:
 *
 * ```
 *   POST /api/chat/email/inbound
 *   content-type:        message/rfc822
 *   x-qb-timestamp:      unix SECONDS
 *   x-qb-mail-slug:      the workspace label, already normalised
 *   x-qb-signature:      lowercase hex
 *                        HMAC-SHA256(secret, `${timestamp}.${mailSlug}.` + raw bytes)
 *   x-qb-envelope-from:  SMTP MAIL FROM
 *   x-qb-envelope-to:    SMTP RCPT TO, verbatim
 *   body:                raw MIME, untouched
 * ```
 *
 * `x-qb-envelope-from` is sent on every delivery and read by nothing here. The
 * author of a message is its `From:` header — that is what DMARC was evaluated
 * against — and the envelope sender is only a bounce address, so nothing on this
 * path has a use for it. It stays in the contract because the contract has two
 * sides: dropping the header from one of them is how a sender and a receiver
 * come to disagree about what is on the wire.
 *
 * Five things are load-bearing.
 *
 * 1. THE SIGNATURE COVERS BYTES, NOT TEXT. MIME is permitted to carry 8-bit
 *    content, and a body decoded to a string before hashing is a different
 *    message: every byte outside UTF-8 becomes U+FFFD, so an 18-byte body can
 *    hash as 26. The body is therefore read as bytes, verified as bytes, and
 *    only then decoded for parsing. This is also why the reader here is
 *    `readBodyWithLimit` rather than the text reader the provider webhook uses.
 *
 * 2. THE KEY IS ITS OWN. {@link INBOUND_HMAC_SECRET_ENV} is deliberately not the
 *    `EMAIL_INBOUND_SIGNING_SECRET` that signs plus-addresses: that value is
 *    fleet-wide and already has a job, and one key with two jobs means one leak
 *    both forges reply addresses and delivers mail. It is also spent as raw
 *    UTF-8 bytes, not base64-decoded like the `whsec_` provider secret — the
 *    Worker signs with `TextEncoder().encode(secret)` and a verifier that
 *    decoded it first would agree with nothing.
 *
 * 3. THE SIGNED SLUG DECIDES WHOSE MAIL THIS IS, AND IT IS CHECKED BEFORE ANY
 *    DATABASE WORK. The workspace label is inside the digest, so the value the
 *    guard rules on is one the Worker vouched for rather than one the caller
 *    supplied. The envelope stays a cross-check rather than the authority. See
 *    {@link deliveryNamesThisWorkspace}.
 *
 * 4. THE ONLY REPLAY DEFENCE IS THE CLOCK. The signed material is
 *    `timestamp . mailSlug . body` and nothing else — no nonce, no message id —
 *    so a captured request is replayable for as long as its timestamp is
 *    accepted. {@link INBOUND_REPLAY_TOLERANCE_SECONDS} is what bounds that, in
 *    BOTH directions: a receiver that only rejects stale timestamps accepts a
 *    far-future one forever, which turns one badly-clocked signer into a
 *    permanent replay licence. Binding the slug narrows what a capture is worth
 *    — it can be replayed at the host it was signed for, never re-aimed at
 *    another workspace's — but it does not replace the window.
 *
 * 5. THE STATUS CODE IS AN SMTP DECISION. The edge sender turns what it gets
 *    back into what the sending mail server is told: 2xx delivers, 404 and most
 *    other 4xx are a PERMANENT rejection, 401/403 and 5xx defer for a later
 *    retry. So each refusal below is chosen for what it makes the sending mail
 *    server do, and the choice is documented where it is made.
 *
 *    The two mistakes are not each other's mirror image, and that asymmetry
 *    decides every ambiguous case. A deferral that should have been a bounce
 *    costs the sender some retries and then bounces anyway; a bounce that should
 *    have been a deferral destroys the message, and no later fix brings it back.
 *    So a rejection here has to rest on a durable fact about the RECIPIENT —
 *    which workspace this host is, and whether the envelope names it. Everything
 *    an operator can change without the sender doing anything differently — a
 *    value not set yet, a surface not switched on yet — defers, because the
 *    retry that follows is what delivers the mail once it is changed.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { logger } from '@/lib/server/logger'
import { readBodyWithLimit } from '@/lib/server/utils/read-body'
import { MAX_EMAIL_WEBHOOK_BODY_BYTES } from './email-webhook-handler'
import {
  isEmailInboundConfigured,
  workspaceSlugFromInboundAddress,
} from './conversation.email-channel'
import { currentMailSlug } from './conversation.mail-slug'
import { parseRawEmail } from './conversation.email-inbound'
import { ingestParsedEmail } from './conversation.email-inbound.service'

type EnvLike = Record<string, string | undefined>

const log = logger.child({ component: 'conversation-email-inbound-cloudflare' })

/** The transport credential. One job, so losing it costs one thing. */
const INBOUND_HMAC_SECRET_ENV = 'INBOUND_HMAC_SECRET'
const INBOUND_DOMAIN_ENV = 'EMAIL_INBOUND_DOMAIN'

const SIGNATURE_HEADER = 'x-qb-signature'
const TIMESTAMP_HEADER = 'x-qb-timestamp'
/**
 * The workspace label, normalised by the Worker and covered by the signature.
 *
 * Carried separately from the envelope rather than derived from it here,
 * because the envelope must stay verbatim: the sub-address in a reply carries a
 * case-sensitive signature that lower-casing to normalise a label would
 * destroy. One header is the case-folded routing decision, the other is the
 * address as the MTA said it.
 */
const MAIL_SLUG_HEADER = 'x-qb-mail-slug'
const ENVELOPE_TO_HEADER = 'x-qb-envelope-to'

/** The media type that tells this transport apart from the provider webhook. */
const RAW_MIME_CONTENT_TYPE = 'message/rfc822'

/**
 * How far either side of now a signed timestamp may sit.
 *
 * Deliberately tighter than the five minutes the provider webhook allows,
 * because the two are bounding different things. A provider retries a webhook
 * for minutes with the original signature; the Worker signs immediately before
 * one POST and re-signs from scratch if Cloudflare redelivers the message. So
 * this only has to cover transit, a TLS handshake and a cold start on this side,
 * plus ordinary NTP skew — and every second beyond that is a second a captured
 * request stays replayable, which with no nonce in the signed material is the
 * only replay bound there is.
 */
export const INBOUND_REPLAY_TOLERANCE_SECONDS = 120

/**
 * Is this request the Worker's raw MIME rather than the provider's JSON?
 *
 * The media type is the whole discriminator, so it is read the way a media type
 * is defined: case-insensitively, and ignoring any parameters after `;`. A
 * request that is not this one goes to the provider webhook path untouched.
 *
 * A repeated `content-type` header is joined by `Headers.get` into one
 * comma-separated value, which is not a media type and matches nothing — so a
 * duplicated header would send raw MIME to the provider door, where it earns a
 * 401 and an indefinite deferral for a message that was in fact perfectly
 * signed. A media type cannot contain a comma, so the first member of that list
 * is the value the sender set and anything after it was appended in flight.
 */
export function isCloudflareInboundRequest(request: Request): boolean {
  const contentType = request.headers.get('content-type') ?? ''
  const first = contentType.split(',')[0]!
  return first.split(';')[0]!.trim().toLowerCase() === RAW_MIME_CONTENT_TYPE
}

/**
 * Is this deployment able to receive mail from the Worker?
 *
 * Strictly stronger than the provider webhook's gate, and that direction is the
 * point: each transport authenticates its own caller with its own credential, so
 * this door additionally requires the key its edge sender holds, and an install
 * running only the provider webhook never starts accepting raw MIME because a
 * fleet-wide value happens to exist. The reverse — this door opening on the
 * provider's credential alone — is what the extra term forbids.
 *
 * What it shares with that gate is the ADDRESSING half — the domain
 * every address this install mints is built on, and the secret that makes one
 * unforgeable — because a front door that accepts mail it can never reply to
 * opens a one-way conversation rather than a working channel. Both are needed
 * for that, and the secret is the one that bites: with it unset every mint
 * returns null, so no Reply-To is ever emitted and every plus-address that does
 * arrive fails verification. Requiring the domain alone would gate on the value
 * whose absence is loud and let through the one whose absence is silent.
 *
 * {@link isEmailInboundConfigured} is that half, asked of the module that owns
 * the grammar rather than restated here, so the two cannot come to disagree
 * about what a mintable address needs.
 */
export function isCloudflareInboundConfigured(env: EnvLike = process.env): boolean {
  return isEmailInboundConfigured(env) && Boolean(env[INBOUND_HMAC_SECRET_ENV])
}

/**
 * Is a signed timestamp inside the replay window?
 *
 * Symmetric, and that is the point: `now - ts > tolerance` alone accepts a
 * timestamp an hour in the future and keeps accepting it for an hour, so a
 * signer with a wrong clock — or a captured request that happens to carry one —
 * becomes a standing replay window. A non-numeric or absent value is not a
 * timestamp at all and fails closed.
 */
export function isFreshInboundTimestamp(
  timestamp: string | null,
  now: number = Date.now(),
  toleranceSeconds: number = INBOUND_REPLAY_TOLERANCE_SECONDS
): boolean {
  if (!timestamp) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  return Math.abs(Math.floor(now / 1000) - ts) <= toleranceSeconds
}

/**
 * Constant-time check of the Worker's signature over these exact bytes.
 *
 * Both header values that later decide something are inside the signed
 * material, which is the whole reason the prefix has the shape it has.
 * `timestamp` cannot be edited to widen the window {@link isFreshInboundTimestamp}
 * enforces, and `mailSlug` cannot be edited to re-aim a captured delivery at
 * another workspace's front door — a rewritten label changes the digest, so it
 * is refused here rather than reaching a guard that would have had to trust it.
 *
 * The key is the secret's raw UTF-8 bytes (note 2 in the module comment), and
 * the digest is compared as its lowercase hex text: parsing the provided hex
 * first would silently truncate a malformed value into something that could
 * compare equal to a short digest.
 *
 * The separators make the prefix unambiguous rather than decorative: `.` cannot
 * occur in a timestamp or in a mail slug (the slug vocabulary excludes it for
 * this class of reason), so no two different (timestamp, slug) pairs can
 * produce the same prefix bytes.
 */
export function verifyInboundSignature(opts: {
  timestamp: string
  mailSlug: string
  signature: string | null
  body: Uint8Array
  secret: string
}): boolean {
  const { timestamp, mailSlug, signature, body, secret } = opts
  if (!signature || !secret) return false

  const expected = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(Buffer.from(`${timestamp}.${mailSlug}.`, 'utf8'))
    .update(body)
    .digest('hex')

  // Case-folded before comparison, because hex has two spellings and a sender
  // that picks the other one is not an attacker. Folding depends on the
  // attacker-supplied value only, never on the expected digest.
  const provided = Buffer.from(signature.trim().toLowerCase(), 'utf8')
  const want = Buffer.from(expected, 'utf8')
  return provided.byteLength === want.byteLength && timingSafeEqual(provided, want)
}

/**
 * THE GUARD: was this delivery signed for THIS workspace, and does its envelope
 * agree?
 *
 * One shared inbound domain stands in front of the whole fleet and one
 * fleet-wide key signs every delivery, so the transport alone says only that a
 * message came from the Worker, never which workspace it is for. Without this
 * check a single valid request drives a Message-ID dedupe query — which
 * `ingestParsedEmail` runs before it has looked up a conversation and before any
 * rate limit — against every workspace on the fleet: unauthenticated fan-out,
 * and a duplicate-versus-not oracle on top of it.
 *
 * `signedSlug` is the authority, because it is the only one of the two that the
 * caller could not have chosen: it is inside the digest
 * {@link verifyInboundSignature} already checked, so by the time this runs it is
 * the label the Worker resolved. The envelope is unauthenticated and stays a
 * cross-check.
 *
 * Five rules, and they are one predicate because a rule applied in pieces is a
 * rule with a way of being applied to only some of them:
 *
 * - A signed label naming another workspace is a rejection, which is the case
 *   the pooled fleet exists to be wrong about.
 * - An absent envelope is a rejection. Mail with no envelope names no address,
 *   and the envelope is what routes it once it is accepted.
 * - An envelope on a domain this install does not receive on is a rejection.
 *   The label is only unique within the domain it was minted under, so a second
 *   zone pointed at the same edge sender would make one label two workspaces'.
 *   Checked while there is one zone rather than when a second arrives, because
 *   the change that adds the second zone is not the change anyone would think
 *   to audit this predicate for.
 * - An `unreadable` envelope is a rejection. It is NOT "no workspace named, so
 *   allow": a local part this grammar cannot mint is a stranger's address or an
 *   attempt at one, and a rule shaped "reject when the label is not ours" waves
 *   through exactly the malformed shapes it exists to catch, because they read
 *   as unreadable rather than as a wrong label.
 * - An envelope whose own label disagrees with the signed one is a rejection.
 *   This is what keeps the verbatim envelope tied to the label that was signed:
 *   the envelope is forwarded unnormalised so a reply's case-sensitive
 *   sub-address survives, which also means it is the one field an attacker on
 *   the path can still edit for free.
 *
 * What that last rule does and does not buy is worth being exact about. Editing
 * the envelope cannot move a message to another workspace: the label inside it
 * has to equal the signed one, and the signed one is in the digest. It CAN
 * still re-aim a message WITHIN this workspace, by swapping one sub-address for
 * another under the same label. Two things stand behind that and neither is
 * this predicate. The sub-address carries an HMAC over the (label, id) pair, so
 * a re-aim needs a valid signed address for the conversation being aimed at —
 * something the attacker has to already hold rather than construct. And the
 * ingest core binds the message to that conversation's visitor, refusing
 * anything whose `From:` is not an address it knows for them. So the reachable
 * case is moving a visitor's own mail between threads they are already party
 * to, which is a routing surprise and not a disclosure.
 *
 * `ourSlug` is null only on a pooled process with no workspace scope, which can
 * name no workspace and so can accept mail for none. `ourDomain` is null only
 * when this install has no inbound domain, which the transport gate has already
 * refused on.
 *
 * The reading is {@link workspaceSlugFromInboundAddress}, which is the same
 * algorithm the Worker normalised with. That is not an accident: if the two
 * differed, an envelope the Worker considered ours could fail the cross-check
 * here and bounce mail that was correctly routed.
 *
 * One thing this predicate cannot be tested for: by the time the envelope's
 * label is compared, `signedSlug` and `ourSlug` have been proved equal, so which
 * of the two names it is compared against is not a behavioural choice and no
 * case can tell them apart. The rules are pinned separately instead — one case
 * where the envelope agrees with a signed label that is not ours, one where it
 * disagrees with a signed label that is.
 */
export function deliveryNamesThisWorkspace(
  envelopeTo: string | null,
  signedSlug: string | null,
  ourSlug: string | null,
  ourDomain: string | null
): envelopeTo is string {
  if (!envelopeTo || !signedSlug || !ourSlug || !ourDomain) return false
  if (signedSlug !== ourSlug) return false
  // Split on the LAST `@` and fold, exactly as the local part beside it is read,
  // so a quoted local part carrying one cannot move the boundary.
  const at = envelopeTo.lastIndexOf('@')
  if (at < 0) return false
  if (
    envelopeTo
      .slice(at + 1)
      .trim()
      .toLowerCase() !== ourDomain.trim().toLowerCase()
  )
    return false
  const named = workspaceSlugFromInboundAddress(envelopeTo)
  return named.kind === 'slug' && named.slug === signedSlug
}

/** `404`, the Worker's "this recipient does not accept mail" — a permanent
 *  rejection the sender is told about, rather than a retry that never succeeds
 *  or a silent drop. Reserved for the one durable fact this host has about a
 *  delivery: which workspace it is, and whether the envelope names it. */
function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

/** `401`, which the Worker defers on: a signature this side could not verify is
 *  a fault in our own key management, and a customer's mail must not be bounced
 *  over it. */
function unauthorized(): Response {
  return new Response('Invalid signature', { status: 401 })
}

/**
 * `503`, which the Worker defers on: this host cannot take the message YET.
 *
 * The doctrine the edge sender applies to a signature it could not get verified
 * — our key management is our problem, so the message waits rather than bounces
 * — is the same doctrine our own missing configuration deserves, and for a
 * sharper reason: the rollout that produces it is the ordinary one. The edge
 * sender ships, the routing rule points at it, and the app's environment is set
 * some minutes later; every message inside that window has a front door with no
 * key behind it. A rejection there tells senders the address does not exist, and
 * nothing done afterwards recalls a bounce. A deferral costs those senders a
 * retry interval and delivers.
 *
 * 503 rather than 401, because 401 is the edge sender's phrase for "the host
 * rejected our signature" and would send whoever reads the log after a
 * credential that is fine. 5xx says the host, not the caller, and the reason
 * code beside it says which.
 */
function serviceUnavailable(detail: string): Response {
  return new Response(detail, { status: 503 })
}

/** Longest error text worth a log line here. Enough to name a driver fault or a
 *  failing constraint, short of a query that echoed a message back. */
const MAX_LOGGED_ERROR_CHARS = 200

/** Anything shaped like an address, however it was quoted or bracketed. */
const ADDRESS_LIKE_RE = /[^\s<>@,;:"()[\]\\]+@[^\s<>@,;:"()[\]\\]+/g

/**
 * An error rendered for a log line on a path that carries a stranger's mail.
 *
 * Two bounds rather than one, because they fail differently. Masking addresses
 * removes the shape actually worth worrying about (a recipient echoed back by
 * whatever threw), and truncation bounds everything it did not think of,
 * including a body fragment carried in a query parameter. Neither is a proof
 * that nothing personal survives, which is why the cap is short: a log line here
 * is for naming a fault, and the operator's real diagnostic on this path is the
 * reason code.
 */
function errorSummary(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : typeof err
  return text.replace(ADDRESS_LIKE_RE, '[address]').slice(0, MAX_LOGGED_ERROR_CHARS)
}

/**
 * Verify, authorize, then ingest. The order is the security property:
 *
 * 1. Is this transport configured here at all? (no key, no front door yet)
 * 2. Does the request carry the whole signed set, and is its timestamp inside
 *    the replay window? (headers only)
 * 3. Is the body within the cap? (bounded read, before anything hashes it)
 * 4. Does the signature verify over that timestamp, that label and those exact
 *    bytes?
 * 5. THE GUARD: does the now-authenticated label name this workspace, and does
 *    the envelope agree with it?
 * 6. Only now: settings, parsing and ingestion, all of which touch the database.
 *
 * Steps 1-5 read headers, bytes and process-local state. Nothing before step 6
 * issues a query, so an unauthenticated or misrouted message costs no database
 * work anywhere on the fleet.
 */
export async function handleCloudflareInboundEmail(request: Request): Promise<Response> {
  if (!isCloudflareInboundConfigured()) {
    // A deferral, not a rejection: see {@link serviceUnavailable}. An unset
    // value is a fact about this deployment at this minute, and the message has
    // to survive until the minute it is set.
    log.warn({ reason: 'transport_unconfigured' }, 'inbound email deferred')
    return serviceUnavailable('Inbound email transport is not configured')
  }

  const signature = request.headers.get(SIGNATURE_HEADER)
  const timestamp = request.headers.get(TIMESTAMP_HEADER)
  if (!signature || !timestamp) {
    log.warn({ reason: 'unsigned' }, 'inbound email refused')
    return unauthorized()
  }
  // Separate from the pair above only so the log names the one cause this has:
  // a Worker older than the signed label. Same 401, and for the same reason it
  // is the right answer — a deferred message is delivered once the two sides
  // match again, where a bounce would have thrown it away over a deploy order.
  const signedSlug = request.headers.get(MAIL_SLUG_HEADER)
  if (!signedSlug) {
    log.warn({ reason: 'no_mail_slug' }, 'inbound email refused')
    return unauthorized()
  }
  // Checked before the body is bought: a replayed capture is refused without
  // reading, hashing or buffering ten megabytes on its behalf. The timestamp is
  // inside the signed material, so trusting it this early cannot widen anything.
  if (!isFreshInboundTimestamp(timestamp)) {
    log.warn({ reason: 'stale_timestamp' }, 'inbound email refused')
    return unauthorized()
  }

  // Bytes, never text — see note 1. The cap is the provider webhook's, matched
  // exactly, because the Worker checks the same number before it sends and a
  // boundary the two sides disagreed about would reject a message both consider
  // legal.
  const body = await readBodyWithLimit(request, MAX_EMAIL_WEBHOOK_BODY_BYTES)
  if (body === null) {
    log.warn({ reason: 'body_too_large' }, 'inbound email refused')
    return new Response('Payload too large', { status: 413 })
  }

  if (
    !verifyInboundSignature({
      timestamp,
      mailSlug: signedSlug,
      signature,
      body,
      secret: process.env[INBOUND_HMAC_SECRET_ENV] ?? '',
    })
  ) {
    log.warn({ reason: 'bad_signature' }, 'inbound email refused')
    return unauthorized()
  }

  // THE GUARD. Deliberately after the signature check, for two reasons: the
  // label it rules on is only trustworthy once the digest that covers it has
  // verified, and answering an identity question for an unauthenticated caller
  // would turn the difference between 404 and 401 into an oracle for which
  // workspace this host serves. Deliberately before everything below it,
  // because everything below it talks to a database.
  const envelopeTo = request.headers.get(ENVELOPE_TO_HEADER)
  if (
    !deliveryNamesThisWorkspace(
      envelopeTo,
      signedSlug,
      currentMailSlug(),
      process.env[INBOUND_DOMAIN_ENV] ?? null
    )
  ) {
    // 404 rather than a defer: this host's own identity is fixed for the
    // hostname the message was delivered to, so it will refuse this delivery on
    // every retry. A defer promises the sender that waiting might help, and a
    // 401 would blame a signature that was in fact perfect, sending whoever
    // reads the log after the wrong fault entirely.
    log.warn({ reason: 'not_this_workspace' }, 'inbound email refused')
    return notFound()
  }

  // Conversations gate: with no visitor surface enabled a reply has nowhere to
  // land. Refused rather than acked-and-dropped, unlike the provider webhook
  // path — that one answers a retrying HTTP client, this one answers a sending
  // mail server, and telling it "delivered" for mail that goes nowhere is the
  // silent loss this whole transport is built to avoid.
  //
  // A deferral rather than a rejection, though. This gate is the OR of three
  // settings an admin flips from the app, so "off" is a state and not a property
  // of the address: a workspace that switches a surface on an hour later gets
  // the mail that was waiting, where a bounce would have thrown it away and told
  // the sender the recipient does not exist. A workspace that stays off simply
  // lets the sender's own retry schedule expire, which is the sender's decision
  // to make rather than ours to make for it.
  const { isConversationsEnabled } = await import('@/lib/server/domains/settings/settings.support')
  if (!(await isConversationsEnabled())) {
    log.warn({ reason: 'conversations_disabled' }, 'inbound email deferred')
    return serviceUnavailable('No visitor surface is enabled')
  }

  // Decoded only now that the bytes have been proven ours. `parseRawEmail` is
  // the same parser the mailbox poller feeds, so no new MIME dependency and no
  // second reading of a message.
  const parsed = parseRawEmail(new TextDecoder().decode(body))

  // The address the message was DELIVERED to routes it, and under forwarding it
  // appears nowhere inside the message: `To:` still names the customer's own
  // support address, which is the header that later resolves their channel
  // account. So the envelope is added to the recipients rather than replacing
  // them. `From:` is left alone for the mirror-image reason — it is the author,
  // it is what DMARC was evaluated against, and the envelope sender is only a
  // bounce address.
  if (!parsed.toAddresses.includes(envelopeTo)) {
    parsed.toAddresses = [envelopeTo, ...parsed.toAddresses]
  }

  try {
    const result = await ingestParsedEmail(parsed)
    // Every outcome is a 2xx, including the drops. The ingest core's refusals
    // are policy — a blocked sender, a throttle, a reply to a conversation that
    // is gone — and turning them into SMTP rejections would both leak that
    // policy to whoever probed it and bounce mail permanently for reasons that
    // are temporary. What deserves a bounce was decided above, before ingestion.
    if (result.status !== 'ingested' && result.status !== 'ingested_ticket') {
      log.warn({ status: result.status }, 'dropped inbound email')
    }
    return Response.json({ status: result.status })
  } catch (err) {
    // 5xx, which the Worker defers on: the message is retried rather than
    // bounced, and the Message-ID dedupe makes the redelivery a no-op.
    //
    // Summarised rather than logged whole. Every other line on this path names
    // a reason code and nothing else, and the reason is that the thing being
    // handled is a stranger's mail; a raw `err` is the one value here whose text
    // this module did not write. Redaction cannot help — it matches the KEY
    // `email`, not a recipient echoed inside a query error or a parser naming
    // the address it choked on.
    log.error({ err_summary: errorSummary(err) }, 'inbound email ingest failed')
    return new Response('Ingest failed', { status: 500 })
  }
}
