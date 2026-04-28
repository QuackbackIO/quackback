/**
 * Filter utilities for inclusive-only filtering
 *
 * Uses "implicit all" pattern where:
 * - No filter param = all items selected (default)
 * - Include param = only these specific items
 */

/**
 * Toggle an item in/out of an include array
 *
 * @param currentInclude - Current include IDs from URL
 * @param itemId - ID to toggle
 * @returns New include array (or undefined if empty, meaning "all")
 */
export function toggleItem<T extends string>(
  currentInclude: T[] | undefined,
  itemId: T
): T[] | undefined {
  const current = currentInclude || []
  if (current.includes(itemId)) {
    const filtered = current.filter((id) => id !== itemId)
    return filtered.length > 0 ? filtered : undefined
  }
  return [...current, itemId]
}

/**
 * Check if an item is selected based on current filter state
 *
 * @param itemId - ID to check
 * @param includeIds - Current include IDs (undefined = all selected)
 * @returns true if selected
 */
export function isItemSelected<T extends string>(itemId: T, includeIds: T[] | undefined): boolean {
  // No filter = all selected (implicit all)
  if (!includeIds || includeIds.length === 0) return true
  return includeIds.includes(itemId)
}
