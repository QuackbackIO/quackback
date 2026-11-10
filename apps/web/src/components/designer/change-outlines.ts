/**
 * What the canvas outlines for a change: each part a change is in, by its
 * `data-qb-section`, and each element a style changed, by its selector (in
 * its part when it has one), a few of each. Read from the frame's page each
 * time it is measured, as the page may draw its parts afresh.
 */
import type { ChangeSpot } from '@/lib/shared/design/change-spots'
import { STYLE_ELEMENTS, type StyleState } from '@/lib/shared/design/style-tokens'

/** Most elements outlined for one style, so a page of buttons is not a page of boxes. */
const MOST_ELEMENTS = 8

/** One thing outlined: a part, or the nth element a selector finds in a part or the page. */
export interface OutlineTarget {
  section?: string
  selector?: string
  nth?: number
  /** The state the element is forced into while outlined. */
  state?: StyleState
}

/** Whether the page lays an element out. */
const drawn = (element: Element) => element.getClientRects().length > 0

function sectionIn(doc: Document, section: string): Element | null {
  for (const element of doc.querySelectorAll('[data-qb-section]'))
    if (element.getAttribute('data-qb-section') === section) return element
  return null
}

function elementsIn(doc: Document, target: OutlineTarget): Element[] {
  const scope = target.section ? sectionIn(doc, target.section) : doc
  if (!scope || !target.selector) return []
  return [...scope.querySelectorAll(target.selector)].filter(drawn)
}

/** The things to outline for a change's spots on the page in the frame. */
export function outlineTargets(doc: Document, spots: readonly ChangeSpot[]): OutlineTarget[] {
  return spots.flatMap((spot): OutlineTarget[] => {
    if (spot.element) {
      const target = {
        selector: STYLE_ELEMENTS[spot.element].selector,
        ...(spot.section ? { section: spot.section } : {}),
        ...(spot.state ? { state: spot.state } : {}),
      }
      return elementsIn(doc, target)
        .slice(0, MOST_ELEMENTS)
        .map((_, nth) => ({ ...target, nth }))
    }
    return spot.section && sectionIn(doc, spot.section) ? [{ section: spot.section }] : []
  })
}

/** The element a target names in the page as it is now, or null where it has gone. */
export function locateTarget(doc: Document, target: OutlineTarget): Element | null {
  if (target.selector) return elementsIn(doc, target)[target.nth ?? 0] ?? null
  return target.section ? sectionIn(doc, target.section) : null
}
