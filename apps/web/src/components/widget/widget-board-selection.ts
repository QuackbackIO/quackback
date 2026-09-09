/**
 * Which board the composer should target, given the boards the viewer can
 * see. Extracted so the rule has one home: it seeds the selection on mount
 * and re-derives it whenever the list changes — on a private portal the SSR
 * seed is empty and the real list only lands with the post-identify refetch.
 *
 * - The configured default board wins when it is in the list.
 * - A single board is auto-selected (the selector is hidden for one board).
 * - Several boards without a default leave the choice to the visitor ('').
 */
export function resolveDefaultBoardId(
  boards: ReadonlyArray<{ id: string; slug: string }>,
  defaultBoard: string | undefined
): string {
  if (defaultBoard) {
    const match = boards.find((b) => b.slug === defaultBoard)
    if (match) return match.id
  }
  if (boards.length === 1) return boards[0].id
  return ''
}

/**
 * Keep a selection that is still valid; otherwise re-derive it. A visitor who
 * picked a board keeps it as long as it exists; an empty or stale selection
 * follows the list.
 */
export function reconcileBoardSelection(
  current: string,
  boards: ReadonlyArray<{ id: string; slug: string }>,
  defaultBoard: string | undefined
): string {
  if (current && boards.some((b) => b.id === current)) return current
  return resolveDefaultBoardId(boards, defaultBoard)
}
