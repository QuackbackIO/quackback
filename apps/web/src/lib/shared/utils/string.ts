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
 * Strip HTML tags from a string.
 * Returns plain text content.
 *
 * @example
 * stripHtml('<p>Hello <strong>world</strong></p>') // 'Hello world'
 * stripHtml('No tags here') // 'No tags here'
 */
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
