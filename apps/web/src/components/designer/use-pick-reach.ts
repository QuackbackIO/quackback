/**
 * What the canvas can say about a picked element: how many of its kind the
 * page shows (and its Home block), the numbers it is drawn with, and what it
 * is drawn with now, numbers and colours, for rows to say where that is not
 * what they store. Read from the canvas as drawn, a moment after each change
 * so it has redrawn; until then there is nothing drawn to compare.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  drawnValues,
  locatePick,
  measuredValue,
  pickKey,
  pickOfKey,
  reachOf,
  type ElementPick,
  type Reach,
} from '@/lib/shared/design/element-pick'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { OverridePage } from '@/lib/shared/design/style-overrides'
import type { StyleProp } from '@/lib/shared/design/style-tokens'

const canvasDoc = () =>
  document.querySelector<HTMLIFrameElement>('iframe[data-designer-canvas]')?.contentDocument ?? null

/** What a picked element is drawn with now, by property. */
export type Drawn = Partial<Record<StyleProp, number | string>>

/** An update that keeps what it had when it reads the same. */
const same =
  <T>(next: T) =>
  (before: T): T =>
    JSON.stringify(before) === JSON.stringify(next) ? before : next

export function usePickReach(
  pick: ElementPick | null,
  design: PortalDesign,
  page: OverridePage | null,
  /** Anything else the canvas draws it by, such as its state, width and mode: a change reads it again. */
  view = ''
): {
  reach: Reach | null
  measure: (prop: StyleProp) => number | undefined
  drawn: Drawn | null
} {
  const [reach, setReach] = useState<Reach | null>(null)
  const [drawn, setDrawn] = useState<Drawn | null>(null)
  // Read by what is picked, not by the object naming it: a pick handed over afresh on each
  // render would read the canvas again each time, and each read renders the builder again.
  const key = pick ? pickKey(pick) : null
  useEffect(() => {
    setDrawn(null)
    const picked = key ? pickOfKey(key) : null
    if (!picked) return setReach(null)
    const timer = setTimeout(() => {
      const doc = canvasDoc()
      const node = doc ? locatePick(doc, picked, design, page) : null
      // Read as before, they are kept as they were, so the builder renders only for news.
      setReach(same(doc ? reachOf(doc, picked, design, page) : null))
      setDrawn(same(node ? drawnValues(node) : null))
    }, 150)
    return () => clearTimeout(timer)
  }, [key, design, page, view])
  const measure = useCallback(
    (prop: StyleProp) => {
      const picked = key ? pickOfKey(key) : null
      const doc = canvasDoc()
      const node = doc && picked ? locatePick(doc, picked, design, page) : null
      return node ? measuredValue(node, prop) : undefined
    },
    [key, design, page]
  )
  return { reach, measure, drawn }
}
