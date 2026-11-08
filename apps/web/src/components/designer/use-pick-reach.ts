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
  useEffect(() => {
    setDrawn(null)
    if (!pick) return setReach(null)
    const timer = setTimeout(() => {
      const doc = canvasDoc()
      setReach(doc ? reachOf(doc, pick, design, page) : null)
      const node = doc ? locatePick(doc, pick, design, page) : null
      setDrawn(node ? drawnValues(node) : null)
    }, 150)
    return () => clearTimeout(timer)
  }, [pick, design, page, view])
  const measure = useCallback(
    (prop: StyleProp) => {
      const doc = canvasDoc()
      const node = doc && pick ? locatePick(doc, pick, design, page) : null
      return node ? measuredValue(node, prop) : undefined
    },
    [pick, design, page]
  )
  return { reach, measure, drawn }
}
