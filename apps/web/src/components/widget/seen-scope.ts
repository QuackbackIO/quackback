/**
 * Whose "seen" markers these are. The widget keeps its badge markers in
 * localStorage, which every visitor in the browser shares, so each identity
 * gets its own: one person's reads never clear another's badges, and a new
 * identity starts from its own silent baseline.
 */
export function seenScope(user: { id: string } | null | undefined): string {
  return user?.id ?? 'anonymous'
}
