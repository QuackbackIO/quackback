import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Space between the header row's logo, menu and buttons (the row's gap-4). */
const GAP = 16

export interface FoldReading {
  /** The menu beside the logo: its content width and the width it is given; null while folded or hidden. */
  menu: { content: number; given: number } | null
  /** The row, the logo and the buttons, as laid out. */
  row: number
  logo: number
  actions: number
}

/**
 * Whether an inline header's menu goes to its own row: it folds when it is
 * wider than the room beside the logo (a wide wordmark and many pages), and
 * comes back once the row has room for its whole width again, so it never
 * scrolls behind the logo and never flips back and forth.
 */
export function foldMenu(
  now: { folded: boolean; needed: number },
  read: FoldReading
): { folded: boolean; needed: number } {
  if (!now.folded) {
    if (read.menu && read.menu.given > 0 && read.menu.content > read.menu.given + 1)
      return { folded: true, needed: read.menu.content }
    return now
  }
  const room = read.row - read.logo - read.actions - 2 * GAP
  return room >= now.needed ? { folded: false, needed: 0 } : now
}

/**
 * Watches an inline header row (marked parts: the menu's scroller
 * `[data-qb-nav-row]`, the logo `[data-qb-part=logo]`, the buttons
 * `[data-qb-header-actions]`) and says whether its menu should fold.
 */
export function useMenuFold(row: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [state, setState] = useState({ folded: false, needed: 0 })
  const current = useRef(state)
  current.current = state
  useLayoutEffect(() => {
    const el = row.current
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const menu = el.querySelector<HTMLElement>('[data-qb-nav-row]')
      const width = (sel: string) => el.querySelector<HTMLElement>(sel)?.offsetWidth ?? 0
      const next = foldMenu(current.current, {
        menu: menu ? { content: menu.scrollWidth, given: menu.clientWidth } : null,
        row: el.clientWidth,
        logo: width('[data-qb-part=logo]'),
        actions: width('[data-qb-header-actions]'),
      })
      if (next.folded !== current.current.folded) setState(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    const menu = el.querySelector('[data-qb-nav-row]')
    if (menu?.firstElementChild) observer.observe(menu.firstElementChild)
    return () => observer.disconnect()
  }, [row, enabled, state.folded])
  return enabled && state.folded
}
