/**
 * String utilities
 */

import slugifyLib from 'slugify'

/**
 * Compute initials from a name string.
 * Returns the first letter of each word, uppercased, limited to 2 characters.
 *
 * @example
 * getInitials('John Doe') // 'JD'
 * getInitials('Alice') // 'A'
 * getInitials(null) // '?'
 */
export function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/**
 * Log-normalize a raw strength score to a 0-10 scale.
 * Uses log2(1 + raw) with a scaling factor calibrated so that
 * a raw score of ~10 (strong multi-author theme) maps to ~8/10.
 */
export function normalizeStrength(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0
  const score = Math.log2(1 + raw) * 2.3
  return Math.min(10, Math.round(score * 10) / 10)
}

/** Map a normalized 0-10 strength score to a tier label. */
export function strengthTier(normalized: number): 'low' | 'medium' | 'high' | 'critical' {
  if (normalized <= 2) return 'low'
  if (normalized <= 5) return 'medium'
  if (normalized <= 8) return 'high'
  return 'critical'
}

/**
 * Format a badge count for display, capping at 99+.
 */
export function formatBadgeCount(n: number): string {
  return n > 99 ? '99+' : String(n)
}

/**
 * Strip markdown formatting and truncate to a plain text preview.
 * Removes headings, bold, italic, links, images, lists, and collapses whitespace.
 */
export function stripMarkdownPreview(text: string, maxLength = 150): string {
  const plain = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[.*?\]\(.+?\)/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
  if (plain.length <= maxLength) return plain
  return plain.slice(0, maxLength).trimEnd() + '...'
}

/**
 * Generate a URL-friendly slug from text.
 * Handles non-Latin scripts (Cyrillic, German umlauts, etc.) via transliteration.
 */
export function slugify(text: string): string {
  return slugifyLib(text, { lower: true, strict: true })
}

/**
 * Truncate text to a maximum length with ellipsis.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

/**
 * Format a status name for display (e.g., "in_progress" -> "In Progress").
 */
export function formatStatus(status: string): string {
  return status
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Get an emoji for a status.
 */
export function getStatusEmoji(status: string): string {
  const map: Record<string, string> = {
    open: '\ud83d\udce5',
    under_review: '\ud83d\udc40',
    planned: '\ud83d\udcc5',
    in_progress: '\ud83d\udea7',
    complete: '\u2705',
    closed: '\ud83d\udd12',
  }
  return map[status.toLowerCase().replace(/\s+/g, '_')] || '\ud83d\udccc'
}

/**
 * Strip HTML and markdown formatting to produce a plain text preview.
 */
export function contentPreview(text: string, maxLength = Infinity): string {
  return stripMarkdownPreview(stripHtml(text), maxLength)
}

/**
 * Obfuscate an email address for safe logging.
 *
 * Retains the first character of the local part and the full domain so
 * operators can still triage domain-level issues. Emails are PII under
 * SOC2/GDPR — unstructured log output (console.log, stderr) is typically
 * ingested by aggregators and retained, so full addresses must not appear.
 *
 * @example
 * safeEmail('alice@example.com')   // 'a***@example.com'
 * safeEmail('b@short.co')          // 'b***@short.co'
 * safeEmail(null)                  // '(no email)'
 */
export function safeEmail(email: string | null | undefined): string {
  if (!email) return '(no email)'
  const at = email.indexOf('@')
  if (at <= 0) return `${email.slice(0, 1)}***`
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`
}

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

export function stripHtml(html: string): string {
  // Strip tag-like sequences (`<` followed by a letter, `/`, or `!`) to a
  // fixpoint so nested fragments can't reassemble into a tag; the closing `>`
  // is optional so an unterminated trailing tag is also dropped. A lone `<`
  // in plain text ("1 < 2") is not tag-like and survives.
  let text = html
  let previous: string
  do {
    previous = text
    text = text.replace(/<[a-z!/][^>]*>?/gi, '')
  } while (text !== previous)

  return text
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (m) => HTML_ENTITIES[m]) // Decode entities in a single pass so "&amp;lt;" yields "&lt;", not "<"
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
}
