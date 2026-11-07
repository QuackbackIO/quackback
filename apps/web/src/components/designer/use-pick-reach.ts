/**
 * What the canvas can say about a picked element: how many of its kind the
 * page shows (and its Home block), and the numbers it is drawn with. Read
 * from the canvas as drawn, a moment after each change so it has redrawn.
 */
import { useCallback, useEffect, useState } from 'react'
import {
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

export function usePickReach(
  pick: ElementPick | null,
  design: PortalDesign,
  page: OverridePage | null
): { reach: Reach | null; measure: (prop: StyleProp) => number | undefined } {
  const [reach, setReach] = useState<Reach | null>(null)
  useEffect(() => {
    if (!pick) return setReach(null)
    const timer = setTimeout(() => {
      const doc = canvasDoc()
      setReach(doc ? reachOf(doc, pick) : null)
    }, 150)
    return () => clearTimeout(timer)
  }, [pick, design, page])
  const measure = useCallback(
    (prop: StyleProp) => {
      const doc = canvasDoc()
      const node = doc && pick ? locatePick(doc, pick, design, page) : null
      return node ? measuredValue(node, prop) : undefined
    },
    [pick, design, page]
  )
  return { reach, measure }
}
