/**
 * Whose "seen" markers these are. The widget keeps its badge markers in
 * localStorage, which every visitor in the browser shares, so each identity
 * gets its own: one person's reads never clear another's badges, and a new
 * identity starts from its own silent baseline.
 *
 * Null until the identity round trip settles: before then the widget does not
 * know who the visitor is, so it reads, counts and writes no marker at all.
 */
export function seenScope(
  user: { id: string } | null | undefined,
  identityResolved: boolean
): string | null {
  if (!identityResolved) return null
  return user?.id ?? 'anonymous'
}

/**
 * Read a scoped marker without writing anything, so it is safe during render.
 * Markers saved before they were kept per person sit under the bare key and
 * are read as this person's until someone adopts them (see adoptLegacyMarker).
 */
export function readScopedMarker(storage: Storage, key: string, scope: string): string | null {
  return storage.getItem(`${key}:${scope}`) ?? storage.getItem(key)
}

/**
 * Move a marker saved before markers were kept per person to this scope and
 * remove the bare key, so an upgrade keeps the first person's badges and the
 * next person does not inherit them. Returns the marker now in effect. When
 * storage refuses the write the legacy value is still returned and left in
 * place for a later attempt.
 */
export function adoptLegacyMarker(storage: Storage, key: string, scope: string): string | null {
  const scopedKey = `${key}:${scope}`
  const scoped = storage.getItem(scopedKey)
  if (scoped !== null) return scoped
  const legacy = storage.getItem(key)
  if (legacy === null) return null
  try {
    storage.setItem(scopedKey, legacy)
    storage.removeItem(key)
  } catch {
    // Storage full or unavailable: the marker still applies for this read.
  }
  return legacy
}
