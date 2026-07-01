/**
 * Inbound email channel config + plus-address routing, kept pure so it's
 * unit-tested directly. The widget's outbound agent-reply emails set a
 * conversation-specific Reply-To (`reply+<id-suffix>.<sig>@<inbound-domain>`);
 * the inbound webhook reads that plus-address back to route a reply into the
 * right conversation. The `<sig>` is an HMAC of the conversation id under the
 * workspace's inbound signing secret, so a third party who receives one of our
 * reply emails cannot forge a reply-to for an ARBITRARY conversation and inject
 * messages as another visitor — the webhook signature only proves the provider
 * forwarded the mail, not the SMTP sender's identity. Both are gated on inbound
 * being configured.
 *
 * Only the TypeID suffix is embedded, not the full `conversation_<suffix>` id:
 * the prefix is constant across every conversation, so carrying it would just
 * burn 13 characters of the RFC 5321 64-char local-part budget for no routing
 * value. The parser re-attaches it. The HMAC is still taken over the full id.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { ID_PREFIXES, type ConversationId } from '@quackback/ids'

type EnvLike = Record<string, string | undefined>

const INBOUND_DOMAIN_ENV = 'EMAIL_INBOUND_DOMAIN'
const INBOUND_SECRET_ENV = 'EMAIL_INBOUND_SIGNING_SECRET'

// `conversation_` — the constant TypeID prefix stripped from the local part on
// the way out and re-attached on the way in.
const CONVERSATION_PREFIX = `${ID_PREFIXES.conversation}_`

// base64url chars of the HMAC-SHA256 tag embedded in the plus-address. The
// local part is `reply+` + a 26-char TypeID suffix + `.` + the tag, so the RFC
// 5321 64-char limit leaves room for 31; 22 (~132 bits) is far beyond what's
// needed to make the id unforgeable while staying well clear of the limit (#293).
const SIG_LEN = 22

/** Decode the `whsec_<base64>` signing secret to raw key bytes, or null. */
function signingKey(env: EnvLike): Buffer | null {
  const secret = env[INBOUND_SECRET_ENV]
  if (!secret) return null
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  return key.byteLength > 0 ? key : null
}

/** Inbound email is usable only when both the receiving domain and the webhook
 *  signing secret are configured. When false, the inbound route 404s and no
 *  routable Reply-To is emitted. */
export function isEmailInboundConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env[INBOUND_DOMAIN_ENV] && env[INBOUND_SECRET_ENV])
}

/** HMAC tag binding a conversation id to this workspace's inbound secret, or
 *  null when no secret is configured. */
export function signConversationId(
  conversationId: string,
  env: EnvLike = process.env
): string | null {
  const key = signingKey(env)
  if (!key) return null
  return createHmac('sha256', key).update(conversationId).digest('base64url').slice(0, SIG_LEN)
}

/** `reply+<id-suffix>.<sig>@<inbound-domain>`, or null when the inbound domain
 *  or signing secret is missing. The `conversation_` prefix is dropped to keep
 *  the local part under the RFC 5321 64-char limit (#293). */
export function inboundReplyToAddress(
  conversationId: ConversationId,
  env: EnvLike = process.env
): string | null {
  const domain = env[INBOUND_DOMAIN_ENV]
  const sig = signConversationId(conversationId, env)
  if (!domain || !sig) return null
  // The `ConversationId` type guarantees the prefix; embed only the bare suffix.
  const suffix = conversationId.slice(CONVERSATION_PREFIX.length)
  return `reply+${suffix}.${sig}@${domain}`
}

/** Extract + verify the conversation id from a `reply+<id-suffix>.<sig>@domain`
 *  recipient. Returns the id only when the signature matches (constant-time);
 *  an unsigned, tampered, or wrong-secret address yields null so a forged
 *  reply-to can't route into someone else's conversation. */
export function conversationIdFromInboundAddress(
  address: string,
  env: EnvLike = process.env
): string | null {
  const match = /reply\+([^@>\s]+)@/i.exec(address)
  if (!match) return null
  const local = match[1]
  // suffix and sig are both dot-free (TypeID base32 + base64url), so the last
  // dot is an unambiguous separator.
  const dot = local.lastIndexOf('.')
  if (dot === -1) return null
  const embedded = local.slice(0, dot)
  const provided = local.slice(dot + 1)
  // Re-attach the prefix. base32 suffixes never contain `_`, so an embedded
  // value that already starts with `conversation_` is a pre-#293 full id.
  const id = embedded.startsWith(CONVERSATION_PREFIX)
    ? embedded
    : `${CONVERSATION_PREFIX}${embedded}`
  const expected = signConversationId(id, env)
  if (!expected) return null
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) return null
  return id
}
