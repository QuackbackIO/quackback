import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { trackBuilder } from '@/lib/client/builder-events'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
import type { Rect } from '@/lib/shared/design/layer-geometry'
import { MENU_COPY } from '@/lib/shared/design/menu-actions'

/** The builder's one-time coach marks: the menu's hint, and the one at Match your brand. */
export type Coach = 'menu' | 'brand'

/** Where the builder remembers that someone has seen a coach mark, per person. */
export const coachKey = (coach: Coach, userId: string) =>
  `quackback:designer-coach-${coach}:${userId}`

/** Where the builder remembers that someone has seen the menu's coach mark, per person. */
export const menuCoachKey = (userId: string) => coachKey('menu', userId)

/**
 * Whether to show a one-time coach mark: until the person signed in closes
 * it, remembered on this device. Nothing shows where storage is closed, so
 * it never nags.
 */
export function useCoach(coach: Coach): { show: boolean; dismiss: () => void } {
  const session = useSessionContext()
  const userId = session?.user?.id ?? null
  const [show, setShow] = useState(false)
  // Read after the first paint, so the server's page and the browser's agree.
  useEffect(() => {
    if (!userId) return
    try {
      setShow(localStorage.getItem(coachKey(coach, userId)) === null)
    } catch {
      setShow(false)
    }
  }, [coach, userId])
  const dismiss = useCallback(() => {
    setShow(false)
    trackBuilder('designer_coach_dismissed', { coach })
    if (!userId) return
    try {
      localStorage.setItem(coachKey(coach, userId), String(Date.now()))
    } catch {
      // Storage closed: it shows again next time, which is the lesser harm.
    }
  }, [coach, userId])
  return { show, dismiss }
}

/** The menu's one-time hint. */
export const useMenuCoach = () => useCoach('menu')

/** Closes a coach mark on Escape, wherever focus is in the builder, ahead of its own Escape. */
export function useEscapeToDismiss(on: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!on) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onDismiss()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [on, onDismiss])
}

/**
 * Whether the menu's hint shows: only while the menu is hovered or picked,
 * with nothing of its own open or dragged.
 */
export function menuHintShown(state: {
  show: boolean
  hasRow: boolean
  /** The header or a menu item is under the pointer, or the header is picked. */
  hot: boolean
  open: boolean
  dragging: boolean
}): boolean {
  return state.show && state.hasRow && state.hot && !state.open && !state.dragging
}

/** The one-time hint under the portal's header, saying what its menu items do. */
export function MenuCoachMark({
  row,
  below,
  room,
  onDismiss,
}: {
  /** The menu's row on the layer. */
  row: Rect
  /** The header's box, which the hint sits under, so it never covers the header when picked. */
  below?: Rect | null
  room: { width: number; height: number }
  onDismiss: () => void
}) {
  useEscapeToDismiss(true, onDismiss)
  const width = 260
  const left = Math.max(8, Math.min(row.left, room.width - width - 8))
  const arrow = Math.max(16, Math.min(row.left + 24 - left, width - 24))
  const bottom = Math.max(row.top + row.height, below ? below.top + below.height : 0)
  return (
    <div
      role="note"
      aria-label={MENU_COPY.coachHint}
      className="pointer-events-auto absolute flex items-center gap-2 rounded-lg border border-border bg-popover py-1.5 ps-3 pe-1.5 text-popover-foreground shadow-lg"
      style={{ left, top: bottom + 10, width }}
    >
      <span
        aria-hidden="true"
        className="absolute -top-1.5 size-3 rotate-45 border-s border-t border-border bg-popover"
        style={{ left: arrow }}
      />
      <p className="min-w-0 flex-1 text-xs">{MENU_COPY.coachHint}</p>
      <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-xs" onClick={onDismiss}>
        {MENU_COPY.coachDone}
      </Button>
    </div>
  )
}
