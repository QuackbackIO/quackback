import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeSpot } from '@/lib/shared/design/change-spots'

/** How long the canvas outlines what an AI step changed. */
export const FLASH_MS = 1500

/** How long a change shown from its row stays outlined, a page switch included. */
export const SHOW_MS = 3000

/** What the canvas outlines just now: the spots, and a count that starts each outline afresh. */
export interface ChangeFlash {
  spots: ChangeSpot[]
  seq: number
}

/**
 * The canvas's outline of what changed: shown for a moment after an AI step
 * applies, or from a Show changes row, then gone. A newer one replaces it.
 */
export function useChangeFlash() {
  const [flash, setFlash] = useState<ChangeFlash | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((spots: ChangeSpot[], ms = FLASH_MS) => {
    if (!spots.length) return
    if (timer.current) clearTimeout(timer.current)
    setFlash((was) => ({ spots, seq: (was?.seq ?? 0) + 1 }))
    timer.current = setTimeout(() => {
      timer.current = null
      setFlash(null)
    }, ms)
  }, [])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  return { flash, show }
}
