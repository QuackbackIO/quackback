/**
 * Inbound email parsing for the email channel, kept pure so it's unit-tested
 * directly. Resend posts an `email.received` event whose `data` carries the
 * parsed message; we normalize the shape we depend on and strip quoted reply
 * history so the ingested chat message is only what the visitor actually wrote.
 */

export interface ParsedInboundEmail {
  /** Recipient addresses (one is our plus-addressed `reply+<id>@domain`). */
  toAddresses: string[]
  from: string | null
  subject: string | null
  text: string | null
  /** Provider Message-ID (header preferred, email id as fallback) for dedupe. */
  messageId: string | null
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
  }
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
