/**
 * Inbound email parsing for the email channel, kept pure so it's unit-tested
 * directly. Two front doors feed the same shape: a provider webhook posts an
 * already-parsed object (`parseInboundEmail`), and the IMAP poller hands us a
 * raw RFC822 message (`parseRawEmail`). Both normalize the fields the ingest
 * path needs and strip quoted reply history so the stored message is only what
 * the visitor actually wrote.
 */

export interface ParsedInboundEmail {
  /** Recipient addresses (one is our plus-addressed `reply+<id>@domain`). */
  toAddresses: string[]
  from: string | null
  subject: string | null
  text: string | null
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
> {
  return {
    inReplyTo: parseMessageIdList(readHeader(headers, 'in-reply-to'))[0] ?? null,
    references: parseMessageIdList(readHeader(headers, 'references')),
    autoSubmitted: readHeader(headers, 'auto-submitted'),
    autoResponseSuppress: readHeader(headers, 'x-auto-response-suppress'),
    precedence: readHeader(headers, 'precedence'),
    hasListHeaders: headersIncludeList(headers),
  }
}

export function parseInboundEmail(data: unknown): ParsedInboundEmail {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const rawTo = d.to
  const toAddresses = Array.isArray(rawTo)
    ? rawTo.filter((t): t is string => typeof t === 'string')
    : typeof rawTo === 'string'
      ? [rawTo]
      : []
  return {
    toAddresses,
    from: asString(d.from),
    subject: asString(d.subject),
    text: asString(d.text),
    messageId: readHeader(d.headers, 'message-id') ?? asString(d.email_id) ?? asString(d.id),
    ...readThreadingHeaders(d.headers),
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

/** Decode a quoted-printable body (soft line breaks + `=XX` octets) to UTF-8.
 *  `=XX` yields a raw byte, so multi-byte sequences are collected then decoded. */
function decodeQuotedPrintable(input: string): string {
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
  return Buffer.from(bytes).toString('utf8')
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

/** Pick the plain-text body: the first text/plain part of a multipart message,
 *  else the whole (decoded) body when it isn't explicitly some other type. */
function extractTextBody(headers: RawHeader[], body: string): string {
  const contentType = readHeader(headers, 'content-type') ?? 'text/plain'

  if (/^multipart\//i.test(contentType)) {
    const boundary = boundaryOf(contentType)
    if (boundary) {
      const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
      for (const part of parts) {
        const trimmed = part.replace(/^\n+/, '')
        const { headerBlock, body: partBody } = splitHeadersAndBody(trimmed)
        const partHeaders = parseRawHeaders(headerBlock)
        const partType = readHeader(partHeaders, 'content-type')
        if (partType && /^text\/plain/i.test(partType)) {
          return decodeBody(readHeader(partHeaders, 'content-transfer-encoding'), partBody)
        }
      }
    }
    return ''
  }

  if (!/^text\//i.test(contentType)) return ''
  return decodeBody(readHeader(headers, 'content-transfer-encoding'), body)
}

/** Parse a raw RFC822 message into the same shape the webhook path produces. */
export function parseRawEmail(raw: string): ParsedInboundEmail {
  const { headerBlock, body } = splitHeadersAndBody(raw)
  const headers = parseRawHeaders(headerBlock)
  const toValue = headers
    .filter((h) => h.name.toLowerCase() === 'to')
    .map((h) => h.value)
    .join(', ')
  const toAddresses = toValue
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
  return {
    toAddresses,
    from: readHeader(headers, 'from'),
    subject: readHeader(headers, 'subject'),
    text: extractTextBody(headers, body),
    messageId: readHeader(headers, 'message-id'),
    ...readThreadingHeaders(headers),
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
