import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { isMenuSelection } from '@/lib/shared/design/menu'
import { outlineKeys, type outlineOf, type Selection } from '@/lib/shared/design/outline'
import { canvasPickOf, NOTHING_PICKED, selectionReducer } from '@/lib/shared/design/selection'
import {
  pickAt,
  pickKey,
  pickName,
  pickOfKey,
  type ElementPick,
} from '@/lib/shared/design/element-pick'
import { backgroundPageOf } from '@/lib/shared/design/page-background'
import type { PortalDesign } from '@/lib/shared/design/schema'

type Nodes = ReturnType<typeof outlineOf>

/** The outline's name for a part, to name the changes made to it. */
export function nodeLabel(nodes: Nodes, key: Selection | null): string | undefined {
  for (const node of nodes) {
    if (node.key === key) return node.label
    const child = node.children?.find((c) => c.key === key)
    if (child) return child.label
  }
  return undefined
}

/**
 * What is picked in the builder, one selection shared by the right panel,
 * the picked block's chip and the AI: a block or a section of the page, or
 * an item of the menu. A click on the page picks the block under it, and a
 * click on empty canvas or Escape lets it go. A pick the page no longer has
 * is no pick.
 */
export function useCanvasSelection({
  nodes,
  design,
  page,
  onPanel,
  onPicked,
  say,
}: {
  nodes: Nodes
  /** The design, whose parts name the elements picked. */
  design: PortalDesign
  /** The page shown; a new one forgets the last click's link and the hover. */
  page?: string
  /** Opens a rail panel: the brand kit and styles are picked there. */
  onPanel: (panel: 'brand' | 'styles') => void
  /** A pick on the page, which leads to its settings. */
  onPicked: () => void
  say: (words: string) => void
}) {
  const [state, dispatch] = useReducer(selectionReducer, NOTHING_PICKED)
  useEffect(() => dispatch({ type: 'reload' }), [page])
  const keys = outlineKeys(nodes)
  const selection =
    state.picked && (isMenuSelection(state.picked) || keys.includes(state.picked as Selection))
      ? (state.picked as Selection)
      : null
  const nameOf = (key: Selection | null) => nodeLabel(nodes, key)

  /** Picks a part, from the panel or the outline; the brand kit and styles open their own panels. */
  const pick = useCallback(
    (next: Selection | null) => {
      if (next === 'site:brand') return onPanel('brand')
      if (next === 'site:styles') return onPanel('styles')
      dispatch({ type: 'pick', key: next })
    },
    [onPanel]
  )
  const setSelection = useCallback(
    (next: Selection | null) => dispatch({ type: 'pick', key: next }),
    []
  )
  const shown = backgroundPageOf(page)
  /** The element a node in the frame's page is, as a pick key. */
  const elementAt = useCallback(
    (target: Element | null | undefined) => {
      const found = target ? pickAt(target, design, shown) : null
      return found ? pickKey(found.pick) : null
    },
    [design, shown]
  )
  /**
   * A click on the page picks the element under it and the block it is in,
   * the block alone on its own box, or lets go on empty canvas.
   *
   * The click rule, the same on every page: the first click picks the
   * innermost thing under the pointer that can be styled on its own
   * (element-pick.ts pickAt). A listed item, such as a post's title or
   * excerpt, is that thing wherever posts are listed (a Home block, the
   * Feedback feed, the roadmap board), never the card around it; else a
   * registered part; else an element kind. The breadcrumb climbs to the
   * block, and Escape goes up a level at a time.
   */
  const select = useCallback(
    (section: string | null, link: string | null, target?: Element | null) => {
      const key = canvasPickOf(section, outlineKeys(nodes)) as Selection | null
      const element = elementAt(target)
      dispatch({ type: 'click', key, href: link, element })
      if (!key && !element) return
      onPicked()
      const pick = element ? pickOfKey(element) : null
      const name = pick ? pickName(pick, design, shown) : nodeLabel(nodes, key)
      if (name) say(`${name} selected. Its settings are on the right.`)
    },
    [nodes, say, onPicked, elementAt, design, shown]
  )
  /** The block the pointer is over, if it is one a click would pick, and the element under it. */
  const hover = useCallback(
    (section: string | null, target?: Element | null) =>
      dispatch({
        type: 'hover',
        key: canvasPickOf(section, outlineKeys(nodes)),
        element: elementAt(target),
      }),
    [nodes, elementAt]
  )
  /** Picks an element of the picked block, or the block itself (null). */
  const pickElement = useCallback(
    (element: ElementPick | null) =>
      dispatch({ type: 'element', element: element ? pickKey(element) : null }),
    []
  )
  /** The frame loaded a page afresh. */
  const reload = useCallback(() => dispatch({ type: 'reload' }), [])
  // The same object while the same element stays picked: what reads the canvas for it reads once.
  const element = useMemo(() => (state.element ? pickOfKey(state.element) : null), [state.element])
  /** Escape lets go of what is picked. */
  const stepBack = useCallback(() => dispatch({ type: 'escape' }), [])
  return {
    selection,
    hovered: state.hovered as Selection | null,
    /** The element picked in the block, or null for the block itself. */
    element,
    elementKey: state.element,
    /** The element under the pointer, by its pick key. */
    hoveredElement: state.hoveredElement,
    pickElement,
    /** The portal path of the link under the last click in the picked block, for Open. */
    link: selection ? state.link : null,
    setSelection,
    pick,
    select,
    hover,
    nameOf,
    stepBack,
    reload,
  }
}
