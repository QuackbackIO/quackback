import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { trackBuilder } from '@/lib/client/builder-events'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
import type { Rect } from '@/lib/shared/design/layer-geometry'
import { MENU_COPY } from '@/lib/shared/design/menu-actions'

/** Where the builder remembers that someone has seen the menu's coach mark, per person. */
export const menuCoachKey = (userId: string) => `quackback:designer-coach-menu:${userId}`

/**
 * Whether to show the one-time note about the portal's menu: until the
 * person signed in says Got it, remembered on this device. Nothing shows
 * where storage is closed, so it never nags.
 */
export function useMenuCoach(): { show: boolean; dismiss: () => void } {
  const session = useSessionContext()
  const userId = session?.user?.id ?? null
  const [show, setShow] = useState(false)
  // Read after the first paint, so the server's page and the browser's agree.
  useEffect(() => {
    if (!userId) return
    try {
      setShow(localStorage.getItem(menuCoachKey(userId)) === null)
    } catch {
      setShow(false)
    }
  }, [userId])
  const dismiss = useCallback(() => {
    setShow(false)
    trackBuilder('designer_coach_dismissed', { coach: 'menu' })
    if (!userId) return
    try {
      localStorage.setItem(menuCoachKey(userId), String(Date.now()))
    } catch {
      // Storage closed: it shows again next time, which is the lesser harm.
    }
  }, [userId])
  return { show, dismiss }
}

/** The one-time note under the portal's menu, saying what its items do. */
export function MenuCoachMark({
  row,
  room,
  onDismiss,
}: {
  /** The menu's row on the layer. */
  row: Rect
  room: { width: number; height: number }
  onDismiss: () => void
}) {
  const width = 300
  const left = Math.max(8, Math.min(row.left, room.width - width - 8))
  const arrow = Math.max(16, Math.min(row.left + 24 - left, width - 24))
  return (
    <div
      role="note"
      aria-labelledby="menu-coach-title"
      className="pointer-events-auto absolute rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-lg"
      style={{ left, top: row.top + row.height + 12, width }}
    >
      <span
        aria-hidden="true"
        className="absolute -top-1.5 size-3 rotate-45 border-s border-t border-border bg-popover"
        style={{ left: arrow }}
      />
      <p id="menu-coach-title" className="text-sm font-semibold">
        {MENU_COPY.coachTitle}
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">{MENU_COPY.coachBody}</p>
      <div className="mt-3 flex items-center justify-end">
        <Button
          size="sm"
          className="bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/85"
          onClick={onDismiss}
        >
          {MENU_COPY.coachDone}
        </Button>
      </div>
    </div>
  )
}
