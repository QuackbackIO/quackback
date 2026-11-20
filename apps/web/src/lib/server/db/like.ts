/**
 * Escape LIKE wildcards (and the escape character itself) so a search term
 * matches literally inside a `%term%` pattern. Postgres LIKE and ILIKE use
 * backslash as their default escape character.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}
