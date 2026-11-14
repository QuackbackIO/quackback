/**
 * Shared keyboard contract for suggestion popovers (`:`, `/`, `@`).
 *
 * Mentions already behaved like Slack (Tab confirms, Home/End jump). Emoji and
 * slash menus only handled arrows + Enter, so Tab did native focus-next. One
 * resolver keeps the three lists in lockstep.
 *
 * Callers keep selected/items/command in refs and pass the latest values in
 * here — the imperative handle must not close over stale React state, or a
 * fast Tab/Enter confirms the wrong row.
 */

export interface SuggestionListKeyState {
  count: number
  selected: number
}

export type SuggestionListKeyResult =
  { type: 'none' } | { type: 'move'; index: number } | { type: 'confirm' }

/** Pure key → intent. Shift+Tab is Tab (confirm), matching Slack/Discord. */
export function resolveSuggestionListKey(
  event: Pick<KeyboardEvent, 'key'>,
  state: SuggestionListKeyState
): SuggestionListKeyResult {
  const { count, selected } = state
  if (count === 0) return { type: 'none' }
  const last = count - 1
  if (event.key === 'ArrowUp') {
    return { type: 'move', index: selected <= 0 ? last : selected - 1 }
  }
  if (event.key === 'ArrowDown') {
    return { type: 'move', index: selected >= last ? 0 : selected + 1 }
  }
  if (event.key === 'Home') {
    return { type: 'move', index: 0 }
  }
  if (event.key === 'End') {
    return { type: 'move', index: last }
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    return { type: 'confirm' }
  }
  return { type: 'none' }
}

/**
 * The row to land on when moving from `start` (already the resolved target)
 * in `step` direction past rows that cannot be picked, wrapping around. -1
 * when no row can be picked.
 */
function nearestPickable<T>(
  items: readonly T[],
  start: number,
  step: 1 | -1,
  isDisabled: (item: T) => boolean
): number {
  const count = items.length
  for (let n = 0; n < count; n++) {
    const index = (((start + step * n) % count) + count) % count
    if (!isDisabled(items[index])) return index
  }
  return -1
}

/** The first row that can be picked, or 0 when none can (nothing confirms then). */
export function firstPickableIndex<T>(
  items: readonly T[],
  isDisabled: (item: T) => boolean
): number {
  return Math.max(0, items.length === 0 ? 0 : nearestPickable(items, 0, 1, isDisabled))
}

export function applySuggestionListKey<T>(
  event: Pick<KeyboardEvent, 'key'>,
  opts: {
    items: readonly T[]
    selected: number
    onMove: (index: number) => void
    onConfirm: (item: T) => void
    /** Rows that show but cannot be picked: moves skip them, confirm ignores them. */
    isDisabled?: (item: T) => boolean
  }
): boolean {
  const result = resolveSuggestionListKey(event, {
    count: opts.items.length,
    selected: opts.selected,
  })
  if (result.type === 'none') return false
  const isDisabled = opts.isDisabled ?? (() => false)
  if (result.type === 'move') {
    // Up and End walk backwards to a pickable row; Down and Home forwards.
    const step = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1
    const index = nearestPickable(opts.items, result.index, step, isDisabled)
    if (index !== -1) opts.onMove(index)
    return true
  }
  const item = opts.items[opts.selected]
  if (item !== undefined && !isDisabled(item)) opts.onConfirm(item)
  return true
}
