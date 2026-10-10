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

export function applySuggestionListKey<T>(
  event: Pick<KeyboardEvent, 'key'>,
  opts: {
    items: readonly T[]
    selected: number
    onMove: (index: number) => void
    onConfirm: (item: T) => void
  }
): boolean {
  const result = resolveSuggestionListKey(event, {
    count: opts.items.length,
    selected: opts.selected,
  })
  if (result.type === 'none') return false
  if (result.type === 'move') {
    opts.onMove(result.index)
    return true
  }
  const item = opts.items[opts.selected]
  if (item !== undefined) opts.onConfirm(item)
  return true
}
