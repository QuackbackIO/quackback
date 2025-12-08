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
