/**
 * String utilities
 */

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
 * Strip HTML tags from a string.
 * Returns plain text content.
 *
 * @example
 * stripHtml('<p>Hello <strong>world</strong></p>') // 'Hello world'
 * stripHtml('No tags here') // 'No tags here'
 */
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
 * Lowercases, replaces non-alphanumeric runs with hyphens, trims leading/trailing hyphens.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
    .replace(/&amp;/g, '&') // Decode ampersand
    .replace(/&lt;/g, '<') // Decode less than
    .replace(/&gt;/g, '>') // Decode greater than
    .replace(/&quot;/g, '"') // Decode quotes
    .replace(/&#39;/g, "'") // Decode apostrophe
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
}
