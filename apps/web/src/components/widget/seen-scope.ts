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

/** How many people's markers of one kind a browser keeps. */
export const MAX_MARKER_SCOPES = 20

const scopedKey = (key: string, scope: string) => `${key}:${scope}`
// The list of scopes holding a marker of this kind, least recently written
// first. The dot keeps it apart from every `${key}:${scope}` marker.
const indexKey = (key: string) => `${key}.scopes`

/** Read one person's marker. Never writes, so it is safe during render. */
export function readScopedMarker(storage: Storage, key: string, scope: string): string | null {
  return storage.getItem(scopedKey(key, scope))
}

/**
 * Write one person's marker. A browser shared by many people keeps only the
 * markers of the most recently active few (see touchScopedMarker): the oldest are removed, and those
 * people start again from a silent baseline. A marker saved before markers
 * were kept per person sits under the bare key; nobody can tell whose it is,
 * so it is removed rather than handed to whoever writes first.
 */
export function writeScopedMarker(storage: Storage, key: string, scope: string, value: string) {
  storage.setItem(scopedKey(key, scope), value)
  storage.removeItem(key)
  touchScopedMarker(storage, key, scope)
}

/**
 * Mark this person as recently active, so their marker is not the next one
 * removed even when it has nothing new to record. Writes only when they are
 * not already the most recent, and never throws.
 */
export function touchScopedMarker(storage: Storage, key: string, scope: string): void {
  try {
    if (storage.getItem(scopedKey(key, scope)) === null) return
    const index = readIndex(storage, key)
    if (index.at(-1) === scope) return
    const scopes = [...index.filter((s) => s !== scope), scope]
    const evicted = scopes.splice(0, Math.max(0, scopes.length - MAX_MARKER_SCOPES))
    for (const old of evicted) storage.removeItem(scopedKey(key, old))
    storage.setItem(indexKey(key), JSON.stringify(scopes))
  } catch {
    // Storage unavailable or full: the order catches up on a later visit.
  }
}

function readIndex(storage: Storage, key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(indexKey(key)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return [] // a corrupted index starts over
  }
}
