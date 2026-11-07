import { useEffect, useState } from 'react'
import { newParts, partsOnNow } from '@/lib/shared/design/menu'
import type { PortalPageGates, PortalPageType } from '@/lib/shared/design/paths'

/** Where the builder remembers the parts that were on when it last opened, on this device. */
export const PARTS_SEEN_KEY = 'quackback:designer-parts-seen'

// Worked out once a page load, so Pages and the overview agree all visit.
let thisVisit: PortalPageType[] | null = null

function readSeen(): PortalPageType[] | null {
  try {
    const raw = localStorage.getItem(PARTS_SEEN_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? (parsed as PortalPageType[]) : null
  } catch {
    return null
  }
}

/**
 * The parts turned on since the builder last opened in this browser: each is
 * New for the whole visit, and the parts on now are remembered for the next.
 * Nothing is new on a first visit, or where storage is closed.
 */
export function useNewParts(gates: PortalPageGates): readonly PortalPageType[] {
  const [fresh, setFresh] = useState<readonly PortalPageType[]>(() => thisVisit ?? [])
  useEffect(() => {
    // Read after the first paint, so the server's page and the browser's agree.
    if (!thisVisit) {
      thisVisit = newParts(readSeen(), gates)
      try {
        localStorage.setItem(PARTS_SEEN_KEY, JSON.stringify(partsOnNow(gates)))
      } catch {
        // Storage closed: nothing is remembered, so nothing shows as new.
      }
    }
    setFresh(thisVisit)
  }, [gates])
  return fresh
}

/** Forgets this visit's answer; for tests. */
export function resetNewParts(): void {
  thisVisit = null
}
