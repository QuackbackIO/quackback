/**
 * Inbound email parsing for the email channel, kept pure so it's unit-tested
 * directly. Two front doors feed the same shape: a provider webhook posts an
 * already-parsed object (`parseInboundEmail`), and the IMAP poller hands us a
 * raw RFC822 message (`parseRawEmail`). Both normalize the fields the ingest
 * path needs and strip quoted reply history so the stored message is only what
 * the visitor actually wrote.
 */
import { realEmail } from '@/lib/shared/anonymous-email'

/**
 * One decoded MIME attachment part (inline image or a discrete file). Produced
 * by both front doors — the IMAP MIME walk and the webhook payload mapping — and
 * consumed by the ingest layer, which rehosts each part to workspace storage
 * (inline `cid:` images rewritten into the HTML; other files → `attachments[]`).
 */
export interface ParsedEmailAttachment {
  /** Decoded raw bytes (base64 / quoted-printable resolved). */
  bytes: Buffer
  /** Declared MIME type, lowercased and param-stripped (e.g. `image/png`); `''` when absent. */
  contentType: string
  /** Filename from Content-Disposition `filename` or Content-Type `name`, or
   *  null. RFC 2047 encoded-words are decoded (see `decodeEncodedWords`). */
  filename: string | null
  /** Bare `Content-ID` (angle brackets stripped) for `cid:` matching, or null. */
  contentId: string | null
  /** Content-Disposition kind; inferred as `inline` for a part carrying a Content-ID. */
  disposition: 'inline' | 'attachment'
}

export interface ParsedInboundEmail {
  /** Recipient addresses (one is our plus-addressed `<slug>+c<id>.<tag>@domain`). */
  toAddresses: string[]
  /** Cc addresses. Cold-inbound (§4.8) turns these into group participants;
   *  the reply path ignores them. Bcc never appears on a received message. */
  ccAddresses: string[]
  /**
   * `Reply-To` addresses, empty when the message carries none.
   *
   * The mail-loop guard's evidence, and the reason it is a field rather than
   * something read where it is needed. On our own outbound mail this is the
   * plus-address we minted; a reply carries none, or the replier's own, because
   * a client answering our mail does not copy the header it is answering. That
   * difference is what lets the guard tell a copy of our own message from an
   * answer to it — see {@link mailLoopSignal}.
   *
   * Kept apart from {@link toAddresses} deliberately. Every genuine reply is
   * ADDRESSED to an address we minted; only a copy of our own message carries
   * one of ours here.
   */
  replyToAddresses: string[]
  from: string | null
  subject: string | null
  text: string | null
  /** HTML body: the provider's `html` field (webhook) or the first `text/html`
   *  MIME part (IMAP). Set alongside `text` when a message carries both; set
   *  alone for an HTML-only message, which `text` (`''`) no longer represents
   *  as "no body" — callers must check both fields for emptiness. */
  html?: string
  /** Provider Message-ID (header preferred, email id as fallback) for dedupe. */
  messageId: string | null
  /** The delivering transport's own id for this message, when the front door
   *  that accepted it carries one. Only a FALLBACK dedupe key, read when
   *  {@link messageId} is null — see {@link inboundDedupeKey}. Absent on every
   *  front door that sends no such id, which is every one but the edge bridge. */
  transportMessageId?: string | null
  /** Provider email id (Resend `email_id`) — used to fetch the body when the
   *  webhook payload is metadata-only (Resend `email.received`, #320). Null for
   *  the IMAP front door, which already carries the full RFC822 body. */
  emailId: string | null
  /** Threading parent from the `In-Reply-To` header (bare id, no `<>`), or null. */
  inReplyTo: string | null
  /** All `References` ids (bare, no `<>`), oldest first — the threading chain. */
  references: string[]
  /** `Auto-Submitted` header value (RFC 3834), or null. */
  autoSubmitted: string | null
  /** `X-Auto-Response-Suppress` header value, or null. */
  autoResponseSuppress: string | null
  /** `Precedence` header value, or null. */
  precedence: string | null
  /** Whether any `List-*` header is present (mailing-list / bulk mail). */
  hasListHeaders: boolean
  /** `Authentication-Results` header the receiving MTA stamped (SPF/DKIM/DMARC),
   *  or null — the cold-inbound trust gate (§4.8) reads it. */
  authenticationResults: string | null
  /** MIME attachment parts (inline images + files), or undefined when the message
   *  carries none. The ingest layer rehosts each to storage. */
  attachments?: ParsedEmailAttachment[]
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * The namespace a transport-supplied id is held in, so it can never be read as a
 * `Message-ID`.
 *
 * The two kinds of id are stored in one column and compared with one equality,
 * which is what lets both share the partial unique index that is the hard
 * backstop against a double insert. Sharing a column means sharing a value
 * space, so the two are separated by construction instead: a real `Message-ID`
 * is stored exactly as the message carried it, and a transport id is only ever
 * stored and only ever looked up behind this prefix.
 *
 * WHICH DIRECTION THIS DEFENDS. A transport id is not covered by the delivery
 * signature, so it is chosen by whoever put it on the wire. Every `Message-ID`
 * we have ever stored is visible to anyone who was on the thread it came from,
 * so without the prefix a chosen transport id equal to one of them would
 * suppress a message by matching a row it has nothing to do with. Prefixed, no
 * chosen value can name a stored `Message-ID` at all.
 *
 * The mirror — a message crafted with a `Message-ID` spelled like a namespaced
 * transport key, to suppress a later message — needs the transport's own id for
 * that later message, assigned by the mail service at receipt and not knowable
 * in advance. The prefix closes the direction that is free; the other one costs
 * a guess nobody can make.
 */
const TRANSPORT_MESSAGE_ID_NAMESPACE = 'qb-transport:'

/**
 * Longest dedupe key worth storing, whichever kind of id it was made from.
 *
 * The key is written into message metadata and indexed, and a btree entry has a
 * hard size ceiling — so an oversized value is not a bad dedupe key, it is an
 * INSERT that throws: a 500, a retry, and a message that never lands. The cap
 * therefore belongs to the KEY rather than to either source of one. A
 * `Message-ID` arrives in a header nobody upstream bounds, and the transport id
 * arrives in another; capping only the id our own sender sets would leave the
 * exposed one uncapped in the same index.
 *
 * Over the cap the message is treated as offering no key at all, exactly like
 * one that carried neither id. Truncating instead would be worse than the
 * throw it avoids: two distinct long ids would truncate to one key, and the
 * second message would be silently suppressed as a duplicate of the first.
 */
export const MAX_DEDUPE_KEY_CHARS = 255

/**
 * Longest transport id a front door should carry, so that a plausible one always
 * fits {@link MAX_DEDUPE_KEY_CHARS} once namespaced.
 *
 * Derived rather than typed a second time: two independently chosen numbers for
 * one ceiling are two numbers that can drift, and the drift would show up as a
 * value accepted at the door that then produces no key at all.
 */
export const MAX_TRANSPORT_MESSAGE_ID_CHARS =
  MAX_DEDUPE_KEY_CHARS - TRANSPORT_MESSAGE_ID_NAMESPACE.length

/**
 * The value this message deduplicates on, or null when it offers none.
 *
 * The message's own `Message-ID` whenever it has one, unchanged and unprefixed:
 * that is what is already stored against every message ingested before this
 * fallback existed, and re-spelling it would make today's copy of a redelivered
 * message fail to match yesterday's row.
 *
 * The transport's id is a FALLBACK and only that. A message that carries a
 * `Message-ID` is deduplicated on it even when a transport id is present, so the
 * unsigned header can never displace the signed message's own identity — and a
 * message carrying neither is exactly as undeduplicable as it was before.
 *
 * One derivation, spent by every reader and every writer of the key: the value
 * looked up before an insert and the value stamped by it come from here, so the
 * two cannot come to disagree and file one message under two spellings.
 */
export function inboundDedupeKey(parsed: ParsedInboundEmail): string | null {
  if (parsed.messageId) {
    return parsed.messageId.length <= MAX_DEDUPE_KEY_CHARS ? parsed.messageId : null
  }
  const transport = parsed.transportMessageId?.trim()
  if (!transport) return null
  const key = `${TRANSPORT_MESSAGE_ID_NAMESPACE}${transport}`
  return key.length <= MAX_DEDUPE_KEY_CHARS ? key : null
}

/** Read a header value case-insensitively from either an array of
 *  `{name,value}` entries or a plain object map. */
function readHeader(headers: unknown, name: string): string | null {
  const want = name.toLowerCase()
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (
        h &&
        typeof h === 'object' &&
        String((h as { name?: unknown }).name).toLowerCase() === want
      ) {
        return asString((h as { value?: unknown }).value)
      }
    }
    return null
  }
  if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (k.toLowerCase() === want) return asString(v)
    }
  }
  return null
}

/** True when any header name begins with `list-` (List-Id, List-Unsubscribe, …). */
function headersIncludeList(headers: unknown): boolean {
  if (Array.isArray(headers)) {
    return headers.some(
      (h) =>
        h &&
        typeof h === 'object' &&
        String((h as { name?: unknown }).name)
          .toLowerCase()
          .startsWith('list-')
    )
  }
  if (headers && typeof headers === 'object') {
    return Object.keys(headers as Record<string, unknown>).some((k) =>
      k.toLowerCase().startsWith('list-')
    )
  }
  return false
}

/**
 * Pull the addr-spec out of a From header value (`Jane <jane@x>` or a bare
 * address), normalized to lower case. Returns null when no plausible single
 * address is present — callers treat that as "sender unknown", never as a
 * wildcard match.
 */
export function extractEmailAddress(raw: string | null): string | null {
  if (!raw) return null
  const angled = raw.match(/<([^<>]+)>\s*$/)
  const candidate = (angled ? angled[1] : raw).trim().toLowerCase()
  if (!candidate || /[\s<>,;"]/.test(candidate)) return null
  const at = candidate.indexOf('@')
  if (at <= 0 || at !== candidate.lastIndexOf('@') || at === candidate.length - 1) return null
  return candidate
}

/**
 * The canonical form of an inbound sender: the bare lower-cased address, with
 * synthetic anonymous placeholders screened out. Both halves are load-bearing —
 * `extractEmailAddress` pulls the addr-spec out of a `Name <addr>` header, and
 * `realEmail` rejects the never-deliverable `temp-<id>@anon.…` domain. Skipping
 * either produces a DIFFERENT rate-limit key, a different stored contact and a
 * different `visitorEmail` per display name, which is exactly how a throttle
 * keyed on the sender becomes evadable by retyping your own name.
 *
 * The one place cold inbound answers "who is this from", so every caller that
 * needs a sender address derives it here rather than re-composing the pair.
 */
export function normalizeSenderAddress(raw: string | null): string | null {
  return realEmail(extractEmailAddress(raw))
}

/** Strip a single surrounding pair of angle brackets from a Message-ID token,
 *  trimmed. Shared with the email store's `normalizeMessageId`. */
export function stripAngleBrackets(id: string): string {
  return id.trim().replace(/^<|>$/g, '')
}

/** Q-encoding is quoted-printable with `_` standing in for a space. Decoded to
 *  bytes first, because a multi-byte character arrives as several `=XX` pairs
 *  and must be decoded as a unit, not per escape. */
function qEncodingToBytes(text: string): Buffer {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '_') {
      out.push(0x20)
    } else if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      out.push(ch.charCodeAt(0) & 0xff)
    }
  }
  return Buffer.from(out)
}

/**
 * Decode RFC 2047 encoded-words (`=?utf-8?Q?caf=C3=A9?=`) in a header value.
 *
 * Any non-ASCII header — a subject in French or Japanese, a sender's display
 * name, an attachment filename — arrives in this form. Left encoded it reaches
 * the agent inbox, AI transcripts and outbound webhooks as visible gibberish,
 * and `email-cold-inbound` truncates the subject to 200 chars, which can sever
 * an encoded-word and make it undecodable after the fact.
 *
 * Plain ASCII passes through untouched, so this is safe to apply to any header.
 * An unknown charset or malformed payload keeps the original token rather than
 * throwing, since a mangled subject beats a rejected message.
 */
export function decodeEncodedWords(value: string | null): string | null {
  if (!value || !value.includes('=?')) return value
  return (
    value
      // Whitespace *between* two encoded-words is folding artefact, not content.
      .replace(/(\?=)\s+(=\?)/g, '$1$2')
      .replace(
        /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
        (whole, charset: string, enc: string, text: string) => {
          try {
            const bytes =
              enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : qEncodingToBytes(text)
            return new TextDecoder(charset.trim().toLowerCase(), { fatal: true }).decode(bytes)
          } catch {
            return whole
          }
        }
      )
  )
}

/** Extract every `<...>` Message-ID token from a header, bare (no angle
 *  brackets) and trimmed. A header with no angle-bracket tokens falls back to
 *  treating its whole trimmed value as one id (some clients omit the brackets). */
export function parseMessageIdList(raw: string | null): string[] {
  if (!raw) return []
  const matches = [...raw.matchAll(/<([^<>]+)>/g)].map((m) => m[1].trim()).filter(Boolean)
  if (matches.length > 0) return matches
  const bare = stripAngleBrackets(raw)
  return bare && !/\s/.test(bare) ? [bare] : []
}

/** The domain part of a Message-ID (`<local@domain>` or bare `local@domain`). */
export function messageIdDomain(messageId: string | null): string | null {
  const [id] = parseMessageIdList(messageId)
  if (!id) return null
  const at = id.lastIndexOf('@')
  if (at === -1 || at === id.length - 1) return null
  return id.slice(at + 1).toLowerCase()
}

function readThreadingHeaders(
  headers: unknown
): Pick<
  ParsedInboundEmail,
  | 'inReplyTo'
  | 'references'
  | 'autoSubmitted'
  | 'autoResponseSuppress'
  | 'precedence'
  | 'hasListHeaders'
  | 'authenticationResults'
> {
  return {
    inReplyTo: parseMessageIdList(readHeader(headers, 'in-reply-to'))[0] ?? null,
    references: parseMessageIdList(readHeader(headers, 'references')),
    autoSubmitted: readHeader(headers, 'auto-submitted'),
    autoResponseSuppress: readHeader(headers, 'x-auto-response-suppress'),
    precedence: readHeader(headers, 'precedence'),
    hasListHeaders: headersIncludeList(headers),
    authenticationResults: readHeader(headers, 'authentication-results'),
  }
}

/** Normalize a provider recipient field (array of strings or a single string). */
function addressArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string')
  return typeof raw === 'string' ? [raw] : []
}

/**
 * Every address in EVERY instance of an address-list header, in the order the
 * message carried them.
 *
 * `readHeader` answers with the first value, which is right for a header that
 * names one thing (`Subject`, `Message-ID`) and wrong for an address list: RFC
 * 5322 permits one `Reply-To`, so a message with two is malformed and no reading
 * of it is more correct than another, but the two front doors must not disagree
 * about it — a guard whose verdict depends on which door a message arrived
 * through has a second, undocumented rule. Both doors read their address lists
 * through here, and reading all of them is also the reading that cannot be
 * evaded by prepending a decoy.
 *
 * An absent or empty value yields no entries rather than one holding nothing, so
 * a caller iterating the list never has to special-case a blank member.
 */
function headerAddresses(headers: unknown, name: string): string[] {
  const want = name.toLowerCase()
  const values: string[] = []
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (!h || typeof h !== 'object') continue
      if (String((h as { name?: unknown }).name).toLowerCase() !== want) continue
      const value = asString((h as { value?: unknown }).value)
      if (value) values.push(value)
    }
  } else {
    // An object-shaped map has one entry per name by construction, so there is
    // nothing to collect beyond it.
    const single = readHeader(headers, name)
    if (single) values.push(single)
  }
  return values.flatMap((value) =>
    value
      .split(',')
      .map((address) => address.trim())
      .filter(Boolean)
  )
}

/**
 * The `Reply-To` addresses of a provider webhook payload.
 *
 * Header block first, payload field second: a provider that hands us the raw
 * headers and one that lifts `Reply-To` into a field of its own both occur, and
 * the mail-loop guard downstream has no other evidence to fall back on.
 *
 * The field is read by the same array-aware reader `to` and `cc` beside it use,
 * because what it lifts out is an address LIST and a list arrives as an array. A
 * string-only reader answered "no Reply-To at all" for the exact payload shape
 * the branch was written for, which is a guard silently wired to nothing.
 * Entries are taken as they stand there (one address per element), while a
 * header LINE is split on commas, which is the shape each actually has.
 */
function webhookReplyToAddresses(d: Record<string, unknown>): string[] {
  const fromHeaderBlock = headerAddresses(d.headers, 'reply-to')
  if (fromHeaderBlock.length > 0) return fromHeaderBlock
  const lifted = addressArray(d.reply_to)
  return lifted.length > 0 ? lifted : addressArray(d.replyTo)
}

/**
 * Map a provider webhook's `attachments` array to decoded parts. Resend's
 * `email.received` event embeds each attachment's payload as a base64 `content`
 * string (the webhook handler sizes its body limit for exactly this); we tolerate
 * both snake_case and camelCase field spellings and a Node-Buffer JSON shape.
 * Parts with no decodable content are skipped.
 */
function parseWebhookAttachments(raw: unknown): ParsedEmailAttachment[] {
  if (!Array.isArray(raw)) return []
  const out: ParsedEmailAttachment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const content = rec.content
    let bytes: Buffer | null = null
    if (typeof content === 'string') {
      try {
        bytes = Buffer.from(content, 'base64')
      } catch {
        bytes = null
      }
    } else if (
      content &&
      typeof content === 'object' &&
      Array.isArray((content as { data?: unknown }).data)
    ) {
      bytes = Buffer.from((content as { data: number[] }).data)
    }
    if (!bytes || bytes.length === 0) continue
    const contentType = asString(rec.content_type ?? rec.contentType) ?? ''
    const cid = asString(rec.content_id ?? rec.contentId)
    const disp = asString(rec.content_disposition ?? rec.disposition)
    out.push({
      bytes,
      contentType: contentType.split(';')[0]!.trim().toLowerCase(),
      filename: asString(rec.filename ?? rec.name),
      contentId: cid ? stripAngleBrackets(cid) || null : null,
      disposition: disp && /inline/i.test(disp) ? 'inline' : cid ? 'inline' : 'attachment',
    })
  }
  return out
}

export function parseInboundEmail(data: unknown): ParsedInboundEmail {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const attachments = parseWebhookAttachments(d.attachments)
  return {
    toAddresses: addressArray(d.to),
    ccAddresses: addressArray(d.cc),
    replyToAddresses: webhookReplyToAddresses(d),
    from: asString(d.from),
    subject: asString(d.subject),
    text: asString(d.text),
    html: asString(d.html) ?? undefined,
    messageId:
      readHeader(d.headers, 'message-id') ??
      asString(d.message_id) ??
      asString(d.email_id) ??
      asString(d.id),
    emailId: asString(d.email_id) ?? asString(d.id),
    ...readThreadingHeaders(d.headers),
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}

// ============================================================================
// Raw RFC822 parsing (IMAP poller). Minimal by design: enough to read the
// headers plus-address/threading routing needs and the plain-text body, with
// no mail-parsing dependency. Not a general MIME parser.
// ============================================================================

interface RawHeader {
  name: string
  value: string
}

/** Split a raw message into its header block and body at the first blank line. */
function splitHeadersAndBody(raw: string): { headerBlock: string; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n')
  const sep = normalized.indexOf('\n\n')
  if (sep === -1) return { headerBlock: normalized, body: '' }
  return { headerBlock: normalized.slice(0, sep), body: normalized.slice(sep + 2) }
}

/** Parse a header block into ordered {name,value} entries, unfolding
 *  continuation lines (leading whitespace) per RFC 5322. */
function parseRawHeaders(headerBlock: string): RawHeader[] {
  const headers: RawHeader[] = []
  for (const line of headerBlock.split('\n')) {
    if (/^[ \t]/.test(line) && headers.length > 0) {
      headers[headers.length - 1].value += ' ' + line.trim()
      continue
    }
    const colon = line.indexOf(':')
    if (colon === -1) continue
    headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() })
  }
  return headers
}

/** Decode a quoted-printable body (soft line breaks + `=XX` octets) to raw bytes.
 *  `=XX` yields a raw byte, so multi-byte sequences are collected as-is. */
function decodeQuotedPrintableBytes(input: string): Buffer {
  const withoutSoftBreaks = input.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < withoutSoftBreaks.length; i++) {
    const ch = withoutSoftBreaks[i]
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(withoutSoftBreaks.slice(i + 1, i + 3))) {
      bytes.push(parseInt(withoutSoftBreaks.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(ch.charCodeAt(0))
    }
  }
  return Buffer.from(bytes)
}

/** Decode a quoted-printable body to UTF-8 text. */
function decodeQuotedPrintable(input: string): string {
  return decodeQuotedPrintableBytes(input).toString('utf8')
}

/** Decode a body segment to raw bytes given its own transfer encoding. Used for
 *  binary attachment parts, where a UTF-8 round-trip would corrupt the bytes. */
function decodeBodyBytes(cte: string | null, body: string): Buffer {
  const enc = (cte ?? '').trim().toLowerCase()
  if (enc === 'base64') {
    try {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64')
    } catch {
      return Buffer.from(body, 'utf8')
    }
  }
  if (enc === 'quoted-printable') return decodeQuotedPrintableBytes(body)
  // 7bit / 8bit / binary / none: best effort. The minimal IMAP client reads the
  // raw message as UTF-8 text, so a non-base64 binary part can already be lossy
  // at the socket — real-world attachments are base64, which is ASCII-safe.
  return Buffer.from(body, 'utf8')
}

/** Read the boundary token from a multipart Content-Type value. */
function boundaryOf(contentType: string): string | null {
  const m = /boundary="?([^";]+)"?/i.exec(contentType)
  return m ? m[1] : null
}

/** Decode a body segment given its own transfer encoding. */
function decodeBody(cte: string | null, body: string): string {
  const enc = (cte ?? '').trim().toLowerCase()
  if (enc === 'base64') {
    try {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8')
    } catch {
      return body
    }
  }
  if (enc === 'quoted-printable') return decodeQuotedPrintable(body)
  return body
}

/** Extracted bodies + attachment parts from a walked MIME tree. `text`/`html`
 *  may be `''` when the message doesn't carry that part. */
interface ExtractedMime {
  text: string
  html: string
  attachments: ParsedEmailAttachment[]
}

/** Read a `param="value"` / `param=value` token from a header value, or null. */
function readParam(header: string | null, name: string): string | null {
  if (!header) return null
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*("[^"]*"|[^;]+)`, 'i').exec(header)
  if (!m) return null
  const value = m[1]!.replace(/^"|"$/g, '').trim()
  return value || null
}

/** The Content-Disposition kind, or null when the header is absent/unknown. */
function readDisposition(cd: string | null): 'inline' | 'attachment' | null {
  if (!cd) return null
  if (/^\s*inline/i.test(cd)) return 'inline'
  if (/^\s*attachment/i.test(cd)) return 'attachment'
  return null
}

/** The bare MIME type (no params), lowercased. */
function mimeOnly(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase()
}

/**
 * Recursively walk a MIME tree, capturing the first text/plain and text/html
 * bodies and collecting every attachment part (inline images + files) — deeper
 * than the old flat one-level scan, so `multipart/mixed(multipart/alternative,
 * <image>, <file>)` reaches its attachments. A text/plain or text/html part is a
 * BODY (not an attachment) only when it has no filename and isn't marked
 * `Content-Disposition: attachment`; everything else at a leaf is an attachment.
 * A leaf with no MIME headers at all is multipart preamble/epilogue, not a part,
 * and is skipped — so only the top-level bare-body message defaults to text/plain.
 */
// Bounds on the MIME walk — a hostile message can nest multipart containers or
// fan out parts without limit; both are capped so a crafted email can't overflow
// the stack (a poison pill the IMAP poller would retry forever) or exhaust memory.
const MAX_MIME_DEPTH = 20
const MAX_MIME_PARTS = 100

function walkMime(
  headers: RawHeader[],
  body: string,
  out: ExtractedMime,
  topLevel: boolean,
  depth = 0
): void {
  if (depth > MAX_MIME_DEPTH) return
  const ctHeader = readHeader(headers, 'content-type')
  const contentType = ctHeader ?? (topLevel ? 'text/plain' : '')

  if (/^multipart\//i.test(contentType)) {
    const boundary = boundaryOf(contentType)
    if (!boundary) return
    const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const segment of body.split(new RegExp(`--${escaped}`))) {
      const trimmed = segment.replace(/^\n+/, '')
      if (!trimmed || /^--/.test(trimmed)) continue
      const { headerBlock, body: partBody } = splitHeadersAndBody(trimmed)
      walkMime(parseRawHeaders(headerBlock), partBody, out, false, depth + 1)
    }
    return
  }

  const cte = readHeader(headers, 'content-transfer-encoding')
  const cd = readHeader(headers, 'content-disposition')
  const cidHeader = readHeader(headers, 'content-id')
  // A segment carrying no MIME headers at all is preamble/epilogue text between
  // boundaries, not a real part — ignore it (only the top-level bare body counts).
  if (!ctHeader && !cd && !cidHeader && !cte && !topLevel) return

  const disposition = readDisposition(cd)
  const filename = readParam(cd, 'filename') ?? readParam(contentType, 'name')
  const isTextPlain = /^text\/plain/i.test(contentType)
  const isTextHtml = /^text\/html/i.test(contentType)
  const isBodyPart = (isTextPlain || isTextHtml) && disposition !== 'attachment' && !filename

  if (isBodyPart) {
    if (isTextPlain && !out.text) out.text = decodeBody(cte, body)
    else if (isTextHtml && !out.html) out.html = decodeBody(cte, body)
    return
  }

  const bytes = decodeBodyBytes(cte, body)
  if (bytes.length === 0) return
  // Bound the collected part count; the rehoster caps uploads separately, but
  // this keeps a fan-out message from filling memory before it gets there.
  if (out.attachments.length >= MAX_MIME_PARTS) return
  const contentId = cidHeader ? stripAngleBrackets(cidHeader) || null : null
  out.attachments.push({
    bytes,
    contentType: mimeOnly(contentType),
    filename: decodeEncodedWords(filename),
    contentId,
    disposition: disposition ?? (contentId ? 'inline' : 'attachment'),
  })
}

/** Walk a message's MIME tree from its top-level headers + body. */
function extractMime(headers: RawHeader[], body: string): ExtractedMime {
  const out: ExtractedMime = { text: '', html: '', attachments: [] }
  walkMime(headers, body, out, true)
  return out
}

/** Parse a raw RFC822 message into the same shape the webhook path produces. */
export function parseRawEmail(raw: string): ParsedInboundEmail {
  const { headerBlock, body } = splitHeadersAndBody(raw)
  const headers = parseRawHeaders(headerBlock)
  const { text, html, attachments } = extractMime(headers, body)
  return {
    toAddresses: headerAddresses(headers, 'to'),
    ccAddresses: headerAddresses(headers, 'cc'),
    replyToAddresses: headerAddresses(headers, 'reply-to'),
    // Raw headers, unlike a provider webhook payload, still carry RFC 2047
    // encoded-words for any non-ASCII display name or subject.
    from: decodeEncodedWords(readHeader(headers, 'from')),
    subject: decodeEncodedWords(readHeader(headers, 'subject')),
    text,
    html: html || undefined,
    messageId: readHeader(headers, 'message-id'),
    emailId: null,
    ...readThreadingHeaders(headers),
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}

/**
 * Loop / auto-mail suppression: drop a message that is machine-generated (an
 * autoresponder, vacation reply, bounce, mailing-list blast) or one of our own
 * outbound mails echoed back. Kept out of the ingest core so it's tested in
 * isolation and shared by every front door.
 */
export function isAutoGeneratedEmail(
  parsed: ParsedInboundEmail,
  ownMessageIdDomains: ReadonlySet<string> = new Set()
): boolean {
  // RFC 3834: anything other than "no" marks an auto-generated/auto-replied mail.
  if (parsed.autoSubmitted && parsed.autoSubmitted.trim().toLowerCase() !== 'no') return true
  // Any suppression hint at all means the sender is a mailbox that won't read a
  // reply (OOF/AutoReply/All).
  if (parsed.autoResponseSuppress && parsed.autoResponseSuppress.trim() !== '') return true
  const precedence = parsed.precedence?.trim().toLowerCase()
  if (precedence === 'bulk' || precedence === 'junk' || precedence === 'list') return true
  if (parsed.hasListHeaders) return true
  // The Message-ID half of the loop question only: an id we minted is a machine
  // mail of ours by construction. The reply-address half is deliberately NOT
  // asked here — it reaches a different disposition (see `mailLoopSignal`) and
  // the ingest core asks it separately, before this.
  if (mailLoopSignal(parsed, ownMessageIdDomains) !== null) return true
  return false
}

/**
 * Why a message looks like one of OUR outbound mails coming back.
 *
 * Three members, and the vocabulary is one union rather than a boolean because
 * they are not equally good evidence and the ingest core does not treat them
 * alike. Two are facts and are dropped; one is our own inference and is
 * retained.
 *
 *   recorded_outbound  the message's own `Message-ID` is a row THIS workspace
 *                      wrote when its own mail went out. Exact, and the only
 *                      member that survives a transport which assigns its own
 *                      ids. Answered by the store, so it is not produced here.
 *   own_message_id     the id's host is a domain whose mail is this workspace's
 *                      own (see `ownMessageIdDomains`). The original test, still
 *                      whole wherever WE mint the id.
 *   own_reply_to       the message carries a reply address this workspace
 *                      minted. An INFERENCE: that address rides in a header any
 *                      sender controls, and everyone we have ever emailed holds
 *                      one.
 */
export type MailLoopSignal = 'recorded_outbound' | 'own_message_id' | 'own_reply_to'

/**
 * Mail-loop detection: one of OUR outbound mails echoing back. Split from
 * `isAutoGeneratedEmail` because the ingest core treats the two differently — a
 * loop is suppressed outright, while other auto-generated mail may be filed to
 * Spam instead.
 *
 * ## Two signals here, because there are two kinds of transport
 *
 * `Message-ID` on a domain of ours answers it wherever WE mint the id: the host
 * is then a zone we operate, and a stranger's mail does not legitimately carry
 * one. That is the whole answer on a mail server we hand a message to. The set
 * handed in must be the domains THIS workspace's own mail is minted on, not
 * every domain the process receives on — on a shared fleet those are the same
 * domains for every workspace, and a neighbour's mail read as ours is the same
 * mistake as the one below, one level in.
 *
 * It is no answer at all on a sending provider that assigns the id itself and
 * replaces ours before signing. The host on the wire is then the PROVIDER's, and
 * it is the same host for every account on that provider's region. Adding it to
 * the set of hosts that mean "ours" is the shortcut to refuse: it reads any of
 * that provider's other customers' mail as our own, converting a loop into
 * silent mail loss with a far wider blast radius — and it looks like a one-line
 * fix and passes a test that never puts a stranger's message through it. So on
 * that transport the question is asked of something we still control: the reply
 * address we minted and put on the message ourselves, which carries this
 * workspace's label under an HMAC tag. See `isOwnInboundAddress` in
 * `conversation.email-channel.ts`.
 *
 * ## Which way it fails
 *
 * `isOwnInboundAddress` is optional, and absent it means every message answers
 * "not ours" and is ingested. That is the direction to be wrong in. A missed
 * loop is a message filed, still bounded by the RFC 3834 / `Precedence` /
 * `List-*` guards beside it and by the dedupe key below. The same asymmetry
 * decides the narrow reading of `Reply-To`: a genuine reply is ADDRESSED to an
 * address we minted, so reading the recipients instead would suppress the entire
 * inbound channel.
 *
 * Reply-To is asked BEFORE the host, so that a message answering both is
 * reported as the inference and retained. Retention costs a Spam row; the other
 * order would cost the message.
 */
export function mailLoopSignal(
  parsed: ParsedInboundEmail,
  ownMessageIdDomains: ReadonlySet<string> = new Set(),
  isOwnInboundAddress?: (address: string) => boolean
): MailLoopSignal | null {
  if (isOwnInboundAddress && parsed.replyToAddresses.some((a) => isOwnInboundAddress(a))) {
    return 'own_reply_to'
  }
  const domain = messageIdDomain(parsed.messageId)
  if (domain !== null && ownMessageIdDomains.has(domain)) return 'own_message_id'
  return null
}

// Lines that mark the start of quoted history from common mail clients. These
// are deliberately well-anchored — a bare `From:` is NOT here because it occurs
// in ordinary prose and a top-level cut on it would silently drop real text.
const QUOTE_SEPARATORS = [
  /^On\s.+\swrote:\s*$/i, // Gmail / Apple Mail
  /^-{2,}\s*Original Message\s*-{2,}/i, // Outlook
  /^_{5,}\s*$/, // Outlook divider
]

/** A line that starts quoted history or a signature block. */
function isCutLine(line: string): boolean {
  // "-- " (trims to "--") is the standard signature delimiter.
  return line.trimEnd() === '--' || QUOTE_SEPARATORS.some((re) => re.test(line))
}

/**
 * Trim quoted reply history and a trailing signature so the stored message is
 * just the visitor's new text. Conservative: cut at the first quote separator
 * or signature delimiter, then drop a fully-quoted trailing block.
 *
 * If that empties the message (e.g. a client put the attribution line first),
 * fall back to the visitor's own non-quoted lines rather than silently dropping
 * a real reply — but a genuinely all-quoted reply still resolves to empty.
 */
export function extractReplyText(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')

  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (isCutLine(lines[i])) {
      cut = i
      break
    }
  }

  const kept = lines.slice(0, cut)
  // Drop any trailing run of quoted (`>`) lines and blank lines left behind.
  while (kept.length > 0) {
    const last = kept[kept.length - 1].trim()
    if (last === '' || last.startsWith('>')) kept.pop()
    else break
  }
  const result = kept.join('\n').trim()
  if (result) return result

  // Recovery: keep any non-blank, non-quoted, non-separator line the visitor
  // actually wrote. All-quoted/separator-only input correctly stays empty.
  return lines
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('>') && !isCutLine(l))
    .join('\n')
    .trim()
}
