/**
 * Format a category's article count for the admin tree.
 *
 * Leaf categories (direct === recursive) show a single number. Parent
 * categories whose articles live under sub-categories show "direct / total"
 * so editors can see both the category's own article count and the total
 * beneath it.
 */
export function formatCategoryCount(direct: number, recursive: number): string {
  if (direct === recursive) return String(direct)
  return `${direct} / ${recursive}`
}
