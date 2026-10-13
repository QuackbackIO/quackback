export function searchResultsHref(query: string): string {
  return `/admin/search?q=${encodeURIComponent(query.trim().slice(0, 200))}`
}
const storageKey = (principalId: string) =>
  `quackback:search:${window.location.host}:${principalId}`
export function readRecentSearches(principalId: string | undefined): string[] {
  if (!principalId) return []
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey(principalId)) ?? '[]')
    return Array.isArray(stored)
      ? stored
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.length > 0 && item.length <= 200
          )
          .slice(0, 8)
      : []
  } catch {
    return []
  }
}
export function rememberSearch(principalId: string | undefined, query: string): void {
  const text = query.trim().slice(0, 200)
  if (!principalId || text.length < 2) return
  try {
    localStorage.setItem(
      storageKey(principalId),
      JSON.stringify(
        [text, ...readRecentSearches(principalId).filter((item) => item !== text)].slice(0, 8)
      )
    )
  } catch {
    /* Search works when browser storage is unavailable. */
  }
}
