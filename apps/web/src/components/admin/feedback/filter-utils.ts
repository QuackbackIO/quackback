/**
 * Filter utilities for smart include/exclude URL parameter optimization
 *
 * These utilities implement the "implicit all" pattern where:
 * - No filter param = all items selected (default)
 * - include param = only these specific items
 * - exclude param = all items EXCEPT these
 *
 * Auto-switches between include/exclude mode at 50% threshold for optimal URL length.
 */

/**
 * Derive which items are currently selected based on URL params
 *
 * @param allIds - Complete list of all available item IDs
 * @param includeIds - IDs explicitly included (from URL ?board=id1&board=id2)
 * @param excludeIds - IDs explicitly excluded (from URL ?excludeBoard=id1)
 * @returns Array of selected IDs
 */
export function deriveSelectedIds<T extends string>(
  allIds: T[],
  includeIds: T[] | undefined,
  excludeIds: T[] | undefined
): T[] {
  // If exclude mode: all items except the excluded ones
  if (excludeIds?.length) {
    const excludeSet = new Set(excludeIds)
    return allIds.filter((id) => !excludeSet.has(id))
  }

  // If include mode: only the included items
  if (includeIds?.length) {
    const includeSet = new Set(includeIds)
    return allIds.filter((id) => includeSet.has(id))
  }

  // No filters = all selected
  return allIds
}

/**
 * Check if an item is selected based on current filter state
 */
export function isItemSelected<T extends string>(
  itemId: T,
  includeIds: T[] | undefined,
  excludeIds: T[] | undefined
): boolean {
  // Exclude mode: selected if NOT in exclude list
  if (excludeIds?.length) {
    return !excludeIds.includes(itemId)
  }

  // Include mode: selected if in include list
  if (includeIds?.length) {
    return includeIds.includes(itemId)
  }

  // No filters = all selected
  return true
}

export interface UrlParams<T> {
  include: T[] | undefined
  exclude: T[] | undefined
}

/**
 * Compute optimal URL params for a given selection
 *
 * Uses the 50% threshold rule:
 * - If >50% selected: use exclude mode (list what's NOT selected)
 * - If <=50% selected: use include mode (list what IS selected)
 * - If 100% selected: use neither (implicit all)
 * - If 0% selected: use include with empty array marker
 *
 * @param allIds - Complete list of all available item IDs
 * @param selectedIds - IDs that should be selected
 * @returns Object with include/exclude arrays for URL
 */
export function computeUrlParams<T extends string>(allIds: T[], selectedIds: T[]): UrlParams<T> {
  const totalCount = allIds.length
  const selectedCount = selectedIds.length

  // All selected = no params needed (implicit all)
  if (selectedCount === totalCount) {
    return { include: undefined, exclude: undefined }
  }

  // None selected = special case
  if (selectedCount === 0) {
    // Return empty include array to indicate "none selected"
    // The UI/service layer should handle this as "show nothing"
    return { include: [], exclude: undefined }
  }

  const selectedSet = new Set(selectedIds)
  const excludedIds = allIds.filter((id) => !selectedSet.has(id))

  // Use whichever mode results in fewer IDs in the URL
  // At exactly 50%, prefer exclude mode (arbitrary choice for consistency)
  if (selectedCount > totalCount / 2) {
    // More than half selected = use exclude mode
    return { include: undefined, exclude: excludedIds }
  } else {
    // Half or fewer selected = use include mode
    return { include: selectedIds, exclude: undefined }
  }
}

/**
 * Toggle an item's selection and return new URL params
 *
 * @param allIds - Complete list of all available item IDs
 * @param currentInclude - Current include IDs from URL
 * @param currentExclude - Current exclude IDs from URL
 * @param itemId - ID to toggle
 * @returns New URL params
 */
export function toggleItem<T extends string>(
  allIds: T[],
  currentInclude: T[] | undefined,
  currentExclude: T[] | undefined,
  itemId: T
): UrlParams<T> {
  // Get current selection state
  const currentSelected = deriveSelectedIds(allIds, currentInclude, currentExclude)

  // Toggle the item
  const isCurrentlySelected = currentSelected.includes(itemId)
  const newSelected = isCurrentlySelected
    ? currentSelected.filter((id) => id !== itemId)
    : [...currentSelected, itemId]

  // Compute optimal URL representation
  return computeUrlParams(allIds, newSelected)
}

/**
 * Check if filters represent "all selected" state
 *
 * This is used to determine if filters are "active" - if all items are selected,
 * the filter isn't really narrowing results.
 */
export function isAllSelected<T extends string>(
  allIds: T[],
  includeIds: T[] | undefined,
  excludeIds: T[] | undefined
): boolean {
  // No params = all selected
  if (!includeIds?.length && !excludeIds?.length) {
    return true
  }

  // Exclude mode with empty list = all selected
  if (excludeIds?.length === 0) {
    return true
  }

  // Include mode with all IDs = all selected
  if (includeIds?.length === allIds.length) {
    const includeSet = new Set(includeIds)
    return allIds.every((id) => includeSet.has(id))
  }

  return false
}
