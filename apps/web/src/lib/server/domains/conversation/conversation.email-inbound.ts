/**
 * Inbound email parsing for the email channel, kept pure so it's unit-tested
 * directly. Two front doors feed the same shape: a provider webhook posts an
 * already-parsed object (`parseInboundEmail`), and the IMAP poller hands us a
 * raw RFC822 message (`parseRawEmail`). Both normalize the fields the ingest
 * path needs and strip quoted reply history so the stored message is only what
 * the visitor actually wrote.
 */

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
  /** Filename from Content-Disposition `filename` or Content-Type `name`, or null.
   *  Kept verbatim — RFC 2047 encoded-words are NOT decoded (no helper exists). */
  filename: string | null
  /** Bare `Content-ID` (angle brackets stripped) for `cid:` matching, or null. */
  contentId: string | null
  /** Content-Disposition kind; inferred as `inline` for a part carrying a Content-ID. */
  disposition: 'inline' | 'attachment'
}

export interface ParsedInboundEmail {
  /** Recipient addresses (one is our plus-addressed `reply+<id>@domain`). */
  toAddresses: string[]
  /** Cc addresses. Cold-inbound (§4.8) turns these into group participants;
   *  the reply path ignores them. Bcc never appears on a received message. */
  ccAddresses: string[]
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

/** Strip a single surrounding pair of angle brackets from a Message-ID token,
 *  trimmed. Shared with the email store's `normalizeMessageId`. */
export function stripAngleBrackets(id: string): string {
  return id.trim().replace(/^<|>$/g, '')
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
    from: asString(d.from),
    subject: asString(d.subject),
    text: asString(d.text),
    html: asString(d.html) ?? undefined,
    messageId: readHeader(d.headers, 'message-id') ?? asString(d.email_id) ?? asString(d.id),
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
function walkMime(headers: RawHeader[], body: string, out: ExtractedMime, topLevel: boolean): void {
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
      walkMime(parseRawHeaders(headerBlock), partBody, out, false)
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
  const contentId = cidHeader ? stripAngleBrackets(cidHeader) || null : null
  out.attachments.push({
    bytes,
    contentType: mimeOnly(contentType),
    filename,
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
  const headerAddresses = (name: string): string[] =>
    headers
      .filter((h) => h.name.toLowerCase() === name)
      .map((h) => h.value)
      .join(', ')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
  const { text, html, attachments } = extractMime(headers, body)
  return {
    toAddresses: headerAddresses('to'),
    ccAddresses: headerAddresses('cc'),
    from: readHeader(headers, 'from'),
    subject: readHeader(headers, 'subject'),
    text,
    html: html || undefined,
    messageId: readHeader(headers, 'message-id'),
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
  ownDomains: ReadonlySet<string> = new Set()
): boolean {
  // RFC 3834: anything other than "no" marks an auto-generated/auto-replied mail.
  if (parsed.autoSubmitted && parsed.autoSubmitted.trim().toLowerCase() !== 'no') return true
  // Any suppression hint at all means the sender is a mailbox that won't read a
  // reply (OOF/AutoReply/All).
  if (parsed.autoResponseSuppress && parsed.autoResponseSuppress.trim() !== '') return true
  const precedence = parsed.precedence?.trim().toLowerCase()
  if (precedence === 'bulk' || precedence === 'junk' || precedence === 'list') return true
  if (parsed.hasListHeaders) return true
  // Our own Message-ID domain coming back in = a mail loop.
  const domain = messageIdDomain(parsed.messageId)
  if (domain && ownDomains.has(domain)) return true
  return false
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
