/**
 * Whose "seen" markers these are. The widget keeps its badge markers in
 * localStorage, which every visitor in the browser shares, so each identity
 * gets its own: one person's reads never clear another's badges, and a new
 * identity starts from its own silent baseline.
 */
export function seenScope(user: { id: string } | null | undefined): string {
  return user?.id ?? 'anonymous'
}

/**
 * Read a scoped marker. Markers saved before they were kept per person sit
 * under the bare key: the first person to read one adopts it, so an upgrade
 * keeps their badges, and the bare key is removed.
 */
export function readScopedMarker(storage: Storage, key: string, scope: string): string | null {
  const scopedKey = `${key}:${scope}`
  const scoped = storage.getItem(scopedKey)
  if (scoped !== null) return scoped
  const legacy = storage.getItem(key)
  if (legacy === null) return null
  storage.setItem(scopedKey, legacy)
  storage.removeItem(key)
  return legacy
}
